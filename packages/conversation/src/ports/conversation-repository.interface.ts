import type { Conversation, ConversationId } from '@projectx/domain';
import type { TenantContext } from '@projectx/domain';

export interface IConversationRepository {
  load(ctx: TenantContext, id: ConversationId): Promise<Conversation | null>;
  save(ctx: TenantContext, conversation: Conversation): Promise<void>;
  findByLeadAndChannel(
    ctx: TenantContext,
    leadId: string,
    channel: string,
  ): Promise<Conversation | null>;
}
