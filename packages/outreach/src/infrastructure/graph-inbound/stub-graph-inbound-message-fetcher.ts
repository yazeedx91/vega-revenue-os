import type { GraphMessagePayload } from './graph-inbound.types';
import type { IGraphInboundMessageFetcher } from './graph-inbound-message-fetcher.interface';

/**
 * Canned/in-memory test double for `IGraphInboundMessageFetcher`. Messages
 * are seeded by `(mailbox, messageId)`; `listChangedMessages` returns every
 * seeded message for the mailbox with `receivedDateTime >= since`.
 */
export class StubGraphInboundMessageFetcher implements IGraphInboundMessageFetcher {
  private readonly messages = new Map<string, GraphMessagePayload>();

  private key(mailbox: string, messageId: string): string {
    return `${mailbox.toLowerCase()}::${messageId}`;
  }

  seed(mailbox: string, message: GraphMessagePayload): void {
    this.messages.set(this.key(mailbox, message.id), message);
  }

  async getMessage(mailbox: string, messageId: string): Promise<GraphMessagePayload | null> {
    return this.messages.get(this.key(mailbox, messageId)) ?? null;
  }

  async listChangedMessages(mailbox: string, since: Date): Promise<GraphMessagePayload[]> {
    const prefix = `${mailbox.toLowerCase()}::`;
    const results: GraphMessagePayload[] = [];
    for (const [key, message] of this.messages.entries()) {
      if (!key.startsWith(prefix)) continue;
      const receivedAt = message.receivedDateTime ? new Date(message.receivedDateTime) : undefined;
      if (!receivedAt || receivedAt >= since) {
        results.push(message);
      }
    }
    return results;
  }
}
