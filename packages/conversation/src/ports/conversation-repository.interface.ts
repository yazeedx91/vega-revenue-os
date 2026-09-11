import type { Conversation, ConversationId } from '@projectx/domain';
import type { TenantContext } from '@projectx/domain';

export interface ConversationRepositoryContext extends TenantContext {
  readonly workspaceId: string;
}

export interface IConversationRepository {
  load(ctx: ConversationRepositoryContext, id: ConversationId): Promise<Conversation | null>;
  save(ctx: ConversationRepositoryContext, conversation: Conversation): Promise<void>;
  findByLeadAndChannel(
    ctx: ConversationRepositoryContext,
    leadId: string,
    channel: string,
  ): Promise<Conversation | null>;
}
