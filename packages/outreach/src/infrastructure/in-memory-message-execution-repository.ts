import { AuthorizationError, TenantIsolationError, type MessageExecutionStatus, type OutreachMessageExecution, type TenantContext } from '@projectx/domain';
import type { OutreachExecutionId, SequenceId } from '@projectx/shared';
import type { IMessageExecutionRepository, OutreachRepositoryContext } from '../ports/outreach-repository.interface';

export class InMemoryMessageExecutionRepository implements IMessageExecutionRepository {
  private readonly store = new Map<string, OutreachMessageExecution>();
  private key(ctx: OutreachRepositoryContext, id: string): string { return `${ctx.tenantId}:${ctx.workspaceId}:${id}`; }
  async save(ctx: OutreachRepositoryContext, e: OutreachMessageExecution): Promise<void> { if(e.tenantId!==ctx.tenantId)throw new TenantIsolationError('Execution tenant mismatch');if(e.workspaceId!==ctx.workspaceId)throw new AuthorizationError('Execution workspace mismatch');this.store.set(this.key(ctx,e.id),e); }
  async load(ctx: OutreachRepositoryContext,id:OutreachExecutionId){return this.store.get(this.key(ctx,id))??null;}
  async findBySequence(ctx:OutreachRepositoryContext,id:SequenceId){return this.workspace(ctx).filter(e=>e.sequenceId===id);}
  async findByIdempotencyKey(ctx:OutreachRepositoryContext,key:string){return this.workspace(ctx).find(e=>e.idempotencyKey===key)??null;}
  async findByStatus(ctx:OutreachRepositoryContext,status:MessageExecutionStatus[]){return this.workspace(ctx).filter(e=>status.includes(e.status));}
  async findByProviderMessageId(ctx:TenantContext,id:string){const workspaceId=(ctx as OutreachRepositoryContext).workspaceId;const r=[...this.store.values()].filter(e=>e.tenantId===ctx.tenantId&&e.providerMessageId===id&&(workspaceId===undefined||e.workspaceId===workspaceId));return r.length===1?r[0]:null;}
  async findByRecipientFingerprint(ctx:OutreachRepositoryContext,fingerprint:string){return this.workspace(ctx).filter(e=>e.recipientFingerprint===fingerprint);}
  private workspace(ctx:OutreachRepositoryContext){return [...this.store.values()].filter(e=>e.tenantId===ctx.tenantId&&e.workspaceId===ctx.workspaceId);}
}
