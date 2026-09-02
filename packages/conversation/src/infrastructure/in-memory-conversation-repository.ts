import type { Conversation, ConversationId, TenantContext } from '@projectx/domain';
import type { IConversationRepository } from '../ports/conversation-repository.interface';

export class InMemoryConversationRepository implements IConversationRepository {
  private readonly store = new Map<string, Conversation>();

  private key(tenantId: string, id: string): string {
    return `${tenantId}:${id}`;
  }

  async load(ctx: TenantContext, id: ConversationId): Promise<Conversation | null> {
    return this.store.get(this.key(ctx.tenantId as string, id)) ?? null;
  }

  async save(ctx: TenantContext, conversation: Conversation): Promise<void> {
    if (conversation.tenantId !== ctx.tenantId) {
      throw new Error('Tenant mismatch');
    }
    this.store.set(this.key(ctx.tenantId as string, conversation.id), conversation);
  }

  async findByLeadAndChannel(
    ctx: TenantContext,
    leadId: string,
    channel: string,
  ): Promise<Conversation | null> {
    for (const conversation of this.store.values()) {
      if (
        conversation.tenantId === ctx.tenantId &&
        conversation.leadId === leadId &&
        conversation.channel === channel
      ) {
        return conversation;
      }
    }
    return null;
  }
}
