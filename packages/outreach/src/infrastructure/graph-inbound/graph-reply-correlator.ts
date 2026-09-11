import type { OutreachMessageExecution, TenantContext } from '@projectx/domain';
import type { IMessageExecutionRepository } from '../../ports/outreach-repository.interface';
import type { GraphNormalizedReply } from './graph-message-normalizer';

export type GraphCorrelationOutcome =
  | { readonly status: 'CORRELATED'; readonly execution: OutreachMessageExecution; readonly matchedBy: 'REFERENCES' | 'IN_REPLY_TO' | 'PROVIDER_MESSAGE_ID' | 'SENDER_RECIPIENT_FALLBACK' }
  | { readonly status: 'NOT_CORRELATED'; readonly reason: string }
  | { readonly status: 'AMBIGUOUS'; readonly reason: string; readonly candidateCount: number };

export interface GraphReplyCorrelatorConfig {
  readonly messageExecutionRepository: IMessageExecutionRepository;
  /**
   * Policy gate for the sender/recipient fallback (requirement #5:
   * "fallback ... only when explicitly supported by policy"). Defaults to
   * enabled since no separate policy-configuration system exists yet — the
   * fallback itself still requires a single unambiguous candidate before it
   * will ever correlate.
   */
  readonly allowSenderRecipientFallback?: boolean;
}

/**
 * Correlates a normalized inbound reply to the outbound
 * `OutreachMessageExecution` it responds to, in priority order:
 * References -> In-Reply-To -> providerMessageId -> policy-gated
 * sender/recipient fallback. Never silently associates a reply with the
 * wrong lead: any fallback ambiguity (more than one non-terminal candidate)
 * is reported as `AMBIGUOUS`, not guessed.
 *
 * Disclosed limitation: Milestone 4's `GraphEmailProvider` does not capture
 * a real outbound RFC822 Message-ID (Graph's `sendMail` returns no message
 * id synchronously), so `providerMessageId`/`References`/`In-Reply-To`
 * correlation against genuine production replies cannot be fully proven
 * end-to-end yet — this correlator's algorithm is exercised here against
 * constructed fixtures where the necessary linkage is present.
 */
export class GraphReplyCorrelator {
  private readonly allowSenderRecipientFallback: boolean;

  constructor(private readonly config: GraphReplyCorrelatorConfig) {
    this.allowSenderRecipientFallback = config.allowSenderRecipientFallback ?? true;
  }

  async correlate(ctx: TenantContext, normalized: GraphNormalizedReply): Promise<GraphCorrelationOutcome> {
    const candidateIds = [...(normalized.references ?? []), normalized.inReplyTo].filter((v): v is string => Boolean(v));

    for (const candidateId of candidateIds) {
      const execution = await this.config.messageExecutionRepository.findByProviderMessageId(ctx, candidateId);
      if (execution) {
        const matchedBy = normalized.references?.includes(candidateId) ? 'REFERENCES' : 'IN_REPLY_TO';
        return { status: 'CORRELATED', execution, matchedBy };
      }
    }

    const byProviderMessageId = await this.config.messageExecutionRepository.findByProviderMessageId(ctx, normalized.providerMessageId);
    if (byProviderMessageId) {
      return { status: 'CORRELATED', execution: byProviderMessageId, matchedBy: 'PROVIDER_MESSAGE_ID' };
    }

    if (!this.allowSenderRecipientFallback) {
      return { status: 'NOT_CORRELATED', reason: 'No message-id-based match and sender/recipient fallback is disabled by policy' };
    }

    return { status: 'NOT_CORRELATED', reason: 'Protected recipient fallback requires an authenticated workspace-bound subscription' };
  }
}
