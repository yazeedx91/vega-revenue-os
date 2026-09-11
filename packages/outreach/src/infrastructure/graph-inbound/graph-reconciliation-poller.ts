import type { ReplyIngressEvent } from '@projectx/domain';
import type { TenantContext } from '@projectx/domain';
import type { IIdempotencyStore } from '@projectx/infrastructure';
import { asIdempotencyKey, asLeadId, asTenantId } from '@projectx/shared';
import { GraphMessageNormalizer, toCanonicalReplyIngressEvent } from './graph-message-normalizer';
import { GraphReplyCorrelator } from './graph-reply-correlator';
import type { IGraphInboundMessageFetcher } from './graph-inbound-message-fetcher.interface';
import type { GraphSubscriptionRecord } from '../../ports/graph-subscription-repository.interface';
import type { TenantEmailConfig } from '../../ports/tenant-email-config-repository.interface';

export interface GraphReconciliationCheckpointStore {
  get(mailbox: string): Promise<Date | undefined>;
  set(mailbox: string, checkpoint: Date): Promise<void>;
}

export class InMemoryGraphReconciliationCheckpointStore implements GraphReconciliationCheckpointStore {
  private readonly checkpoints = new Map<string, Date>();

  async get(mailbox: string): Promise<Date | undefined> {
    return this.checkpoints.get(mailbox.toLowerCase());
  }

  async set(mailbox: string, checkpoint: Date): Promise<void> {
    this.checkpoints.set(mailbox.toLowerCase(), checkpoint);
  }
}

export interface GraphReconciliationPollerConfig {
  readonly messageFetcher: IGraphInboundMessageFetcher;
  readonly normalizer: GraphMessageNormalizer;
  readonly correlator: GraphReplyCorrelator;
  readonly idempotencyStore: IIdempotencyStore;
  readonly checkpointStore: GraphReconciliationCheckpointStore;
  /** How far back to look on the very first poll for a mailbox with no checkpoint yet. */
  readonly initialLookbackMs?: number;
}

export interface GraphReconciliationResult {
  readonly processed: ReplyIngressEvent[];
  readonly skippedDuplicates: number;
  readonly notCorrelated: number;
  readonly ambiguous: number;
}

const IDEMPOTENCY_SCOPE = 'outreach:inbound-email';
const DEFAULT_INITIAL_LOOKBACK_MS = 60 * 60 * 1000;

/**
 * Periodic fallback for notifications the webhook missed (delivery
 * failures, subscription gaps, etc.). Reuses the exact same normalize ->
 * correlate -> dedup pipeline as the webhook path, keyed through the same
 * `IIdempotencyStore` scope, so a message the webhook already processed is
 * silently skipped here rather than reprocessed.
 */
export class GraphReconciliationPoller {
  private readonly initialLookbackMs: number;

  constructor(private readonly config: GraphReconciliationPollerConfig) {
    this.initialLookbackMs = config.initialLookbackMs ?? DEFAULT_INITIAL_LOOKBACK_MS;
  }

  async pollMailbox(tenantConfig: TenantEmailConfig): Promise<GraphReconciliationResult> {
    const mailbox = tenantConfig.fromAddress;
    const ctx: TenantContext = { tenantId: asTenantId(tenantConfig.tenantId), correlationId: `graph-reconciliation-${mailbox}` };

    const since = (await this.config.checkpointStore.get(mailbox)) ?? new Date(Date.now() - this.initialLookbackMs);
    const messages = await this.config.messageFetcher.listChangedMessages(mailbox, since);

    const processed: ReplyIngressEvent[] = [];
    let skippedDuplicates = 0;
    let notCorrelated = 0;
    let ambiguous = 0;
    let latestReceivedAt = since;

    for (const message of messages) {
      const dedupKey = asIdempotencyKey(`poll:${message.id}`);
      const claim = await this.config.idempotencyStore.claim(ctx, IDEMPOTENCY_SCOPE, dedupKey, { ttlSeconds: 24 * 60 * 60 });
      if (!claim.claimed) {
        skippedDuplicates += 1;
        continue;
      }

      const normalized = this.config.normalizer.normalize(message);
      if (normalized.status !== 'NORMALIZED') {
        continue;
      }

      const reconciliationSubscription: GraphSubscriptionRecord = {
        tenantId: tenantConfig.tenantId,
        subscriptionId: `reconciliation:${mailbox}`,
        subscriptionScope: 'LEGACY_UNBOUND',
        workspaceId: null,
        resource: '/users/' + mailbox + '/messages',
        notificationUrl: '',
        clientState: '',
        expirationDateTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const correlation = await this.config.correlator.correlate(ctx, reconciliationSubscription, normalized.event);
      if (correlation.status === 'NOT_CORRELATED') {
        notCorrelated += 1;
        continue;
      }
      if (correlation.status === 'AMBIGUOUS') {
        ambiguous += 1;
        continue;
      }

      processed.push(
        toCanonicalReplyIngressEvent(normalized.event, {
          tenantId: tenantConfig.tenantId,
          workspaceId: correlation.workspaceId,
          leadId: asLeadId(correlation.leadId),
          campaignId: correlation.execution?.campaignId as string | undefined,
          sequenceId: correlation.execution?.sequenceId as string | undefined,
          executionId: correlation.execution?.id as string | undefined,
        }),
      );

      if (message.receivedDateTime) {
        const receivedAt = new Date(message.receivedDateTime);
        if (receivedAt > latestReceivedAt) {
          latestReceivedAt = receivedAt;
        }
      }
    }

    await this.config.checkpointStore.set(mailbox, latestReceivedAt);
    return { processed, skippedDuplicates, notCorrelated, ambiguous };
  }
}
