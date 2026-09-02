import type { ReplyIngressEvent } from '@projectx/domain';
import type { LeadId } from '@projectx/shared';
import { sanitizeInboundHtml } from './graph-html-sanitizer';
import type { GraphMessagePayload } from './graph-inbound.types';

export type GraphNormalizationOutcome =
  | { readonly status: 'NORMALIZED'; readonly event: GraphNormalizedReply }
  | { readonly status: 'OVERSIZED'; readonly reason: string }
  | { readonly status: 'MALFORMED'; readonly reason: string };

/**
 * A `ReplyIngressEvent` missing the correlation-derived fields
 * (`tenantId`/`leadId`/`campaignId`/`sequenceId`/`executionId`) — those are
 * filled in by `graph-reply-correlator.ts` after this step, plus the
 * `hadAttachments` flag (out-of-band, never persisted into the canonical
 * event; attachment *content* is never fetched or stored in this
 * milestone).
 */
export type GraphNormalizedReply = Omit<ReplyIngressEvent, 'tenantId' | 'leadId'> & {
  readonly hadAttachments: boolean;
};

export interface GraphMessageNormalizerConfig {
  /** Maximum accepted plain-text/HTML body length (characters). */
  readonly maxBodyLength?: number;
}

const DEFAULT_MAX_BODY_LENGTH = 200_000;

function findHeader(message: GraphMessagePayload, name: string): string | undefined {
  return message.internetMessageHeaders?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

function parseReferences(headerValue: string | undefined): string[] | undefined {
  if (!headerValue) return undefined;
  const refs = headerValue.split(/\s+/).map((r) => r.trim()).filter(Boolean);
  return refs.length > 0 ? refs : undefined;
}

/**
 * Maps a raw Graph message payload into the canonical, provider-neutral
 * shape. Attachments are never fetched or stored — only a boolean presence
 * flag is retained. Oversized/malformed inputs are rejected rather than
 * truncated silently.
 */
export class GraphMessageNormalizer {
  private readonly maxBodyLength: number;

  constructor(config?: GraphMessageNormalizerConfig) {
    this.maxBodyLength = config?.maxBodyLength ?? DEFAULT_MAX_BODY_LENGTH;
  }

  normalize(message: GraphMessagePayload): GraphNormalizationOutcome {
    if (!message.id) {
      return { status: 'MALFORMED', reason: 'Message is missing an id' };
    }

    const rawBody = message.body?.content ?? message.bodyPreview ?? '';
    if (rawBody.length > this.maxBodyLength) {
      return { status: 'OVERSIZED', reason: `Message body exceeds ${this.maxBodyLength} characters` };
    }

    const isHtml = message.body?.contentType === 'html';
    const htmlBody = isHtml ? sanitizeInboundHtml(rawBody) : undefined;
    // A plain-text `content` is always derived — from the provided plain
    // body when available, else from a naive tag-strip of the sanitized
    // HTML (adequate for downstream intent classification; not intended as
    // a faithful text-rendering of the HTML).
    const content = isHtml ? (htmlBody ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : rawBody;

    const receivedAt = message.receivedDateTime ? new Date(message.receivedDateTime) : new Date();
    if (Number.isNaN(receivedAt.getTime())) {
      return { status: 'MALFORMED', reason: 'Invalid receivedDateTime' };
    }

    const inReplyTo = findHeader(message, 'In-Reply-To');
    const references = parseReferences(findHeader(message, 'References'));

    const event: GraphNormalizedReply = {
      channel: 'email',
      providerMessageId: message.id,
      content,
      receivedAt,
      messageIdHeader: message.internetMessageId ?? findHeader(message, 'Message-ID'),
      sender: message.from?.emailAddress?.address,
      recipientAddress: message.toRecipients?.[0]?.emailAddress?.address,
      subject: message.subject,
      htmlBody,
      inReplyTo,
      references,
      hadAttachments: message.hasAttachments ?? false,
    };

    return { status: 'NORMALIZED', event };
  }
}

/** Attaches correlation-derived identity fields once known, producing the final canonical event. */
export function toCanonicalReplyIngressEvent(
  normalized: GraphNormalizedReply,
  correlation: { tenantId: string; leadId: LeadId; campaignId?: string; sequenceId?: string; executionId?: string },
): ReplyIngressEvent {
  const { hadAttachments, ...rest } = normalized;
  void hadAttachments;
  return {
    ...rest,
    tenantId: correlation.tenantId,
    leadId: correlation.leadId,
    campaignId: correlation.campaignId,
    sequenceId: correlation.sequenceId,
    executionId: correlation.executionId,
  };
}
