import type { MessageExecutionStatus, OutreachMessageExecution, TenantContext } from '@projectx/domain';
import type { IHistoricalRecipientFingerprint } from '../../ports/outbound-recipient-recovery.interface';
import type { GraphSubscriptionRecord, GraphSubscriptionScope } from '../../ports/graph-subscription-repository.interface';
import type { IMessageExecutionRepository, OutreachRepositoryContext } from '../../ports/outreach-repository.interface';
import type { GraphNormalizedReply } from './graph-message-normalizer';

export type GraphCorrelationMatchMethod = 'REFERENCES' | 'IN_REPLY_TO' | 'PROVIDER_MESSAGE_ID' | 'SENDER_RECIPIENT_FALLBACK';

export type GraphCorrelationOutcome =
  | {
      readonly status: 'CORRELATED';
      readonly execution?: OutreachMessageExecution;
      readonly leadId: string;
      readonly workspaceId: string;
      readonly matchedBy: GraphCorrelationMatchMethod;
    }
  | { readonly status: 'NOT_CORRELATED'; readonly reason: string }
  | { readonly status: 'AMBIGUOUS'; readonly reason: string; readonly candidateCount: number };

export interface GraphReplyCorrelatorConfig {
  readonly messageExecutionRepository: IMessageExecutionRepository;
  readonly historicalRecipientFingerprint: IHistoricalRecipientFingerprint;
}

const FALLBACK_STATUSES: MessageExecutionStatus[] = [
  'PROVIDER_ACCEPTED',
  'DELIVERY_PENDING',
  'DELIVERED',
  'OPENED',
  'REPLIED',
];

function extractKeyVersion(fingerprint: string): string | null {
  const parts = fingerprint.split('.');
  if (parts.length < 3 || parts[0] !== 'h1') return null;
  return parts[1] ?? null;
}

interface MessageIdMatch {
  readonly execution: OutreachMessageExecution;
  readonly matchedBy: GraphCorrelationMatchMethod;
  readonly inScope: boolean;
}

/**
 * Correlates a normalized inbound reply to the outbound
 * `OutreachMessageExecution` it responds to, in priority order:
 * References -> In-Reply-To -> provider message id -> protected
 * sender/recipient fallback. The fallback is only available for
 * authenticated WORKSPACE_BOUND subscriptions and uses historical HMAC
 * versions. Never silently guesses: any ambiguity (more than one Lead
 * or, for LEGACY_UNBOUND, any fallback attempt or ambiguous exact match)
 * is reported as `NOT_CORRELATED` or `AMBIGUOUS`.
 */
export class GraphReplyCorrelator {
  constructor(private readonly config: GraphReplyCorrelatorConfig) {}

  async correlate(
    ctx: TenantContext,
    subscription: GraphSubscriptionRecord,
    normalized: GraphNormalizedReply,
  ): Promise<GraphCorrelationOutcome> {
    const matches = await this.findByMessageIds(ctx, subscription, normalized);
    const inScope = matches.filter((m) => m.inScope);
    const outOfScope = matches.filter((m) => !m.inScope);

    if (subscription.subscriptionScope === 'WORKSPACE_BOUND') {
      if (inScope.length === 0 && outOfScope.length > 0) {
        return { status: 'NOT_CORRELATED', reason: 'Workspace A subscription cannot authorize workspace B execution' };
      }
      if (inScope.length > 1) {
        return { status: 'AMBIGUOUS', reason: 'Multiple message-id-based matches in workspace', candidateCount: inScope.length };
      }
      if (inScope.length === 1) {
        const match = inScope[0]!;
        return this.toCorrelated(match.execution, match.matchedBy);
      }
    } else {
      if (matches.length > 1) {
        return { status: 'NOT_CORRELATED', reason: 'LEGACY_UNBOUND requires exactly one durable execution; multiple found' };
      }
      if (matches.length === 1) {
        const match = matches[0]!;
        return this.toCorrelated(match.execution, match.matchedBy);
      }
    }

    if (subscription.subscriptionScope === 'LEGACY_UNBOUND') {
      return { status: 'NOT_CORRELATED', reason: 'LEGACY_UNBOUND subscription does not permit sender/recipient fallback' };
    }

    if (!subscription.workspaceId) {
      return { status: 'NOT_CORRELATED', reason: 'WORKSPACE_BOUND subscription has no authoritative workspace' };
    }

    const workspaceCtx: OutreachRepositoryContext = {
      ...ctx,
      workspaceId: subscription.workspaceId,
    };

    return this.senderRecipientFallback(workspaceCtx, normalized);
  }

  private toCorrelated(execution: OutreachMessageExecution, matchedBy: GraphCorrelationMatchMethod): GraphCorrelationOutcome {
    return {
      status: 'CORRELATED',
      execution,
      leadId: execution.leadId,
      workspaceId: execution.workspaceId,
      matchedBy,
    };
  }

  private async findByMessageIds(
    ctx: TenantContext,
    subscription: GraphSubscriptionRecord,
    normalized: GraphNormalizedReply,
  ): Promise<MessageIdMatch[]> {
    const results: MessageIdMatch[] = [];
    const candidateIds = [...(normalized.references ?? []), normalized.inReplyTo].filter((v): v is string => Boolean(v));

    for (const candidateId of candidateIds) {
      const execution = await this.config.messageExecutionRepository.findByProviderMessageId(ctx, candidateId);
      if (execution) {
        const matchedBy = normalized.references?.includes(candidateId) ? 'REFERENCES' : 'IN_REPLY_TO';
        results.push({
          execution,
          matchedBy,
          inScope: subscription.subscriptionScope === 'WORKSPACE_BOUND' ? execution.workspaceId === (subscription.workspaceId ?? '') : true,
        });
      }
    }

    if (normalized.providerMessageId) {
      const execution = await this.config.messageExecutionRepository.findByProviderMessageId(ctx, normalized.providerMessageId);
      if (execution) {
        results.push({
          execution,
          matchedBy: 'PROVIDER_MESSAGE_ID',
          inScope: subscription.subscriptionScope === 'WORKSPACE_BOUND' ? execution.workspaceId === (subscription.workspaceId ?? '') : true,
        });
      }
    }

    return results;
  }

  private async senderRecipientFallback(
    ctx: OutreachRepositoryContext,
    normalized: GraphNormalizedReply,
  ): Promise<GraphCorrelationOutcome> {
    if (!normalized.sender) {
      return { status: 'NOT_CORRELATED', reason: 'Protected sender/recipient fallback requires a sender address' };
    }

    const candidates = await this.config.messageExecutionRepository.findByStatus(ctx, FALLBACK_STATUSES);
    const matchedExecutions: OutreachMessageExecution[] = [];

    for (const execution of candidates) {
      if (!execution.recipientFingerprint || execution.recipientProtectionState !== 'PROTECTED') {
        continue;
      }
      const keyVersion = extractKeyVersion(execution.recipientFingerprint);
      if (!keyVersion) {
        continue;
      }
      try {
        const computed = await this.config.historicalRecipientFingerprint.fingerprintEmailForVersion(
          ctx.tenantId as string,
          normalized.sender,
          keyVersion,
        );
        if (computed === execution.recipientFingerprint) {
          matchedExecutions.push(execution);
        }
      } catch {
        // Missing or invalid historical key for this candidate; skip it.
      }
    }

    if (matchedExecutions.length === 0) {
      return { status: 'NOT_CORRELATED', reason: 'No protected sender/recipient match found' };
    }

    const firstLeadId = matchedExecutions[0]?.leadId;
    if (matchedExecutions.some((e) => e.leadId !== firstLeadId)) {
      return { status: 'NOT_CORRELATED', reason: 'Sender/recipient fallback matches multiple Leads' };
    }

    const execution = matchedExecutions[0];
    if (!execution) {
      return { status: 'NOT_CORRELATED', reason: 'No protected sender/recipient match found' };
    }

    if (matchedExecutions.length === 1) {
      return {
        status: 'CORRELATED',
        execution,
        leadId: execution.leadId,
        workspaceId: execution.workspaceId,
        matchedBy: 'SENDER_RECIPIENT_FALLBACK',
      };
    }

    return {
      status: 'CORRELATED',
      leadId: firstLeadId,
      workspaceId: execution.workspaceId,
      matchedBy: 'SENDER_RECIPIENT_FALLBACK',
    };
  }
}
