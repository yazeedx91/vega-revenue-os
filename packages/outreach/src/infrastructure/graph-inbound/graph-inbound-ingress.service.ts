import type { TenantContext } from '@projectx/domain';
import type { ReplyIngressEvent } from '@projectx/domain';
import type { IIdempotencyStore } from '@projectx/infrastructure';
import { asIdempotencyKey, asCorrelationId, asLeadId, asTenantId } from '@projectx/shared';
import type { GraphChangeNotification } from './graph-inbound.types';
import { GraphWebhookValidator } from './graph-webhook-validator';
import { GraphTenantResolver } from './graph-tenant-resolver';
import { GraphMessageNormalizer, toCanonicalReplyIngressEvent } from './graph-message-normalizer';
import { GraphReplyCorrelator } from './graph-reply-correlator';
import type { IGraphSubscriptionRepository } from '../../ports/graph-subscription-repository.interface';
import type { IGraphInboundMessageFetcher } from './graph-inbound-message-fetcher.interface';

export type GraphInboundIngressOutcome =
  | { readonly status: 'PROCESSED'; readonly event: ReplyIngressEvent; readonly isDuplicate: false }
  | { readonly status: 'DUPLICATE'; readonly isDuplicate: true }
  | { readonly status: 'REJECTED'; readonly reasonCode: string; readonly reason: string }
  | { readonly status: 'NOT_CORRELATED'; readonly reason: string }
  | { readonly status: 'AMBIGUOUS'; readonly reason: string };

export interface GraphInboundIngressServiceConfig {
  readonly validator: GraphWebhookValidator;
  readonly tenantResolver: GraphTenantResolver;
  readonly subscriptionRepository: IGraphSubscriptionRepository;
  readonly messageFetcher: IGraphInboundMessageFetcher;
  readonly normalizer: GraphMessageNormalizer;
  readonly correlator: GraphReplyCorrelator;
  readonly idempotencyStore: IIdempotencyStore;
}

const IDEMPOTENCY_SCOPE = 'outreach:inbound-email';

/**
 * Orchestrates validate -> resolve tenant -> atomic dedup claim -> fetch ->
 * normalize -> correlate for a single Graph change notification. Never
 * calls `ConversationHandlingService` — see the Milestone 6 completion
 * report for why (avoiding an `outreach` -> `conversation` circular
 * dependency); the caller (`apps/api`'s orchestrator) is responsible for the
 * conversation/intent/NBA/lead-outcome/Temporal-signal steps once this
 * returns a `PROCESSED` outcome.
 */
export class GraphInboundIngressService {
  constructor(private readonly config: GraphInboundIngressServiceConfig) {}

  async ingest(notification: GraphChangeNotification): Promise<GraphInboundIngressOutcome> {
    const shapeOutcome = this.config.validator.validateShape(notification);
    if (shapeOutcome.status !== 'VALID') {
      return { status: 'REJECTED', reasonCode: shapeOutcome.status, reason: shapeOutcome.reason };
    }

    const tenantOutcome = await this.config.tenantResolver.resolve(notification.resource);
    if (tenantOutcome.status !== 'RESOLVED') {
      return { status: 'REJECTED', reasonCode: 'TENANT_NOT_FOUND', reason: tenantOutcome.reason };
    }

    const resolvedCtx: TenantContext = {
      tenantId: asTenantId(tenantOutcome.config.tenantId),
      correlationId: asCorrelationId(`graph-subscription-check-${notification.subscriptionId}`),
    };
    const subscription = await this.config.subscriptionRepository.findBySubscriptionId(
      resolvedCtx,
      notification.subscriptionId,
    );
    if (!subscription) {
      return {
        status: 'REJECTED',
        reasonCode: 'TENANT_SUBSCRIPTION_MISMATCH',
        reason: 'Subscription is not registered for this tenant',
      };
    }
    if (notification.resource !== subscription.resource && !notification.resource.startsWith(`${subscription.resource}/`)) {
      return {
        status: 'REJECTED',
        reasonCode: 'SUBSCRIPTION_RESOURCE_MISMATCH',
        reason: 'Subscription resource does not cover the notification resource',
      };
    }

    const clientStateOutcome = await this.config.validator.validateClientState(notification, tenantOutcome.config.webhookSecretReference);
    if (clientStateOutcome.status !== 'VALID') {
      return { status: 'REJECTED', reasonCode: clientStateOutcome.status, reason: clientStateOutcome.reason };
    }

    const ctx: TenantContext = {
      tenantId: asTenantId(tenantOutcome.config.tenantId),
      correlationId: `graph-notification-${notification.subscriptionId}-${notification.resourceData?.id ?? notification.resource}`,
    };

    const messageId = notification.resourceData?.id;
    if (!messageId) {
      return { status: 'REJECTED', reasonCode: 'MALFORMED', reason: 'Notification is missing resourceData.id' };
    }

    // Atomic dedup claim — reused from Milestone 4's IIdempotencyStore.claim().
    // The dedup key intentionally covers (subscriptionId, messageId): the
    // same underlying Graph message could theoretically appear under
    // multiple subscriptions, but never needs double-processing per
    // subscription.
    const dedupKey = asIdempotencyKey(`${notification.subscriptionId}:${messageId}`);
    const claim = await this.config.idempotencyStore.claim(ctx, IDEMPOTENCY_SCOPE, dedupKey, { ttlSeconds: 24 * 60 * 60 });
    if (!claim.claimed) {
      return { status: 'DUPLICATE', isDuplicate: true };
    }

    const mailbox = this.config.tenantResolver.extractMailbox(notification.resource);
    if (!mailbox) {
      return { status: 'REJECTED', reasonCode: 'MALFORMED', reason: 'Could not extract mailbox from resource' };
    }

    const rawMessage = await this.config.messageFetcher.getMessage(mailbox, messageId);
    if (!rawMessage) {
      return { status: 'REJECTED', reasonCode: 'MESSAGE_NOT_FOUND', reason: `Graph message ${messageId} could not be fetched` };
    }

    const normalizationOutcome = this.config.normalizer.normalize(rawMessage);
    if (normalizationOutcome.status !== 'NORMALIZED') {
      return { status: 'REJECTED', reasonCode: normalizationOutcome.status, reason: normalizationOutcome.reason };
    }

    const correlation = await this.config.correlator.correlate(ctx, subscription, normalizationOutcome.event);
    if (correlation.status === 'NOT_CORRELATED') {
      return { status: 'NOT_CORRELATED', reason: correlation.reason };
    }
    if (correlation.status === 'AMBIGUOUS') {
      return { status: 'AMBIGUOUS', reason: correlation.reason };
    }

    const event = toCanonicalReplyIngressEvent(normalizationOutcome.event, {
      tenantId: tenantOutcome.config.tenantId,
      workspaceId: correlation.workspaceId,
      leadId: asLeadId(correlation.leadId),
      campaignId: correlation.execution?.campaignId as string | undefined,
      sequenceId: correlation.execution?.sequenceId as string | undefined,
      executionId: correlation.execution?.id as string | undefined,
    });

    return { status: 'PROCESSED', event, isDuplicate: false };
  }
}
