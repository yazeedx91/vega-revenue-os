import type { GraphMessagePayload } from './graph-inbound.types';

export interface IGraphInboundMessageFetcher {
  /** GET `/users/{mailbox}/messages/{messageId}` (full metadata + headers). */
  getMessage(mailbox: string, messageId: string): Promise<GraphMessagePayload | null>;
  /**
   * Delta/changed-messages query since a checkpoint, used by the
   * reconciliation poller to recover notifications the webhook missed.
   */
  listChangedMessages(mailbox: string, since: Date): Promise<GraphMessagePayload[]>;
}
