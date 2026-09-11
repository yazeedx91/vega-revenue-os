import type { TenantContext } from '@projectx/domain';
import type { ReplyIngressEvent } from '@projectx/domain';
import type { IMessageExecutionRepository, ISuppressionRepository } from '@projectx/outreach';
import type { OutreachExecutionId } from '@projectx/shared';

export interface PersistReplyOptOutDeps {
  readonly suppressionRepository: ISuppressionRepository;
  readonly messageExecutionRepository: IMessageExecutionRepository;
}

/**
 * Turns a conversation-detected reply-based opt-out into a durable
 * suppression record so it blocks every future outbound send path (not just
 * the conversation flow that detected it). `ReplyIngressEvent` does not
 * always carry the address to suppress directly, so it is resolved via the
 * originating `OutreachMessageExecution` when `event.executionId` is
 * present, falling back to `event.sender` (the prospect's own address, per
 * the Milestone 6 Graph inbound pipeline) when it is not.
 * `event.recipientAddress` is deliberately never used here — it denotes the
 * tenant's own inbound mailbox, not the prospect address to suppress. If no
 * address can be resolved, this is a no-op (the opt-out is still honored
 * within the conversation itself via `conversation.optedOut`).
 *
 * Extracted as a shared helper (Phase 14 Milestone 6) so both the Temporal
 * `interpretReply` activity path and the `apps/api` Graph webhook path use
 * one implementation rather than duplicating this logic.
 */
export async function persistReplyBasedOptOut(
  ctx: TenantContext,
  event: ReplyIngressEvent,
  deps: PersistReplyOptOutDeps,
): Promise<void> {
  const recipientAddress = event.sender;

  if (!recipientAddress) {
    return;
  }

  await deps.suppressionRepository.suppress(ctx, recipientAddress, 'OPT_OUT', 'conversation-reply-handler', 'Prospect opted out via reply');
}
