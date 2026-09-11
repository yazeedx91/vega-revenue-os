import { AuthorizationError, TenantIsolationError, type Conversation, type ConversationId } from '@projectx/domain';
import type { ConversationRepositoryContext, IConversationRepository } from '../ports/conversation-repository.interface';

export class InMemoryConversationRepository implements IConversationRepository {
  private readonly store = new Map<string, Conversation>();
  private key(ctx:ConversationRepositoryContext,id:string){return `${ctx.tenantId}:${ctx.workspaceId}:${id}`;}
  async load(ctx:ConversationRepositoryContext,id:ConversationId){return this.store.get(this.key(ctx,id))??null;}
  async save(ctx:ConversationRepositoryContext,c:Conversation){if(c.tenantId!==ctx.tenantId)throw new TenantIsolationError('Conversation tenant mismatch');if(c.workspaceId!==ctx.workspaceId)throw new AuthorizationError('Conversation workspace mismatch');this.store.set(this.key(ctx,c.id),c);}
  async findByLeadAndChannel(ctx:ConversationRepositoryContext,leadId:string,channel:string){return [...this.store.values()].find(c=>c.tenantId===ctx.tenantId&&c.workspaceId===ctx.workspaceId&&c.leadId===leadId&&c.channel===channel)??null;}
}
