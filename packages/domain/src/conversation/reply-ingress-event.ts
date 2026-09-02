import type { LeadId } from '@projectx/shared';

/**
 * Canonical, provider-neutral inbound-reply event. Lives in `domain` (not
 * `conversation`) so that `packages/outreach`'s inbound-ingress pipeline can
 * produce this shape without creating an `outreach` -> `conversation`
 * dependency (the reverse direction, `conversation` -> `outreach`, already
 * exists). Any inbound channel/provider (Microsoft Graph, a future provider,
 * etc.) must normalize into this exact contract — no provider-specific
 * types belong here.
 *
 * All fields beyond the original four are additive/optional so every
 * existing caller (e.g. the Temporal `interpretReply` activity, in-memory
 * `IReplyIngress` test doubles) continues to compile and behave unchanged.
 */
export interface ReplyIngressEvent {
  readonly tenantId: string;
  readonly leadId: LeadId;
  readonly channel: string;
  readonly providerMessageId: string;
  readonly content: string;
  readonly receivedAt: Date;
  readonly campaignId?: string;
  readonly sequenceId?: string;
  readonly executionId?: string;

  /** Canonical `Message-Id` header value of the inbound message itself (not the one it replies to). */
  readonly messageIdHeader?: string;
  /** Reply sender address (the prospect). */
  readonly sender?: string;
  /** Address the reply was sent to (the outbound mailbox). */
  readonly recipientAddress?: string;
  readonly subject?: string;
  /** Sanitized rich-text body, when the provider supplied one. Plain-text `content` remains canonical. */
  readonly htmlBody?: string;
  /** `In-Reply-To` header value(s) — the Message-Id this reply is directly responding to. */
  readonly inReplyTo?: string;
  /** `References` header values — the full thread chain of Message-Ids, oldest first. */
  readonly references?: string[];
}
