import { AuthorizationError, TenantIsolationError, type OutreachSequence } from '@projectx/domain';
import type { CampaignId, SequenceId } from '@projectx/shared';
import type { ISequenceRepository, OutreachRepositoryContext } from '../ports/outreach-repository.interface';

export class InMemorySequenceRepository implements ISequenceRepository {
  private readonly store = new Map<string, OutreachSequence>();
  private key(ctx: OutreachRepositoryContext, id: string): string { return `${ctx.tenantId}:${ctx.workspaceId}:${id}`; }
  async save(ctx: OutreachRepositoryContext, sequence: OutreachSequence): Promise<void> {
    if (sequence.tenantId !== ctx.tenantId) throw new TenantIsolationError('Sequence tenant mismatch');
    if (sequence.workspaceId !== ctx.workspaceId) throw new AuthorizationError('Sequence workspace mismatch');
    this.store.set(this.key(ctx, sequence.id), sequence);
  }
  async load(ctx: OutreachRepositoryContext, id: SequenceId): Promise<OutreachSequence | null> { return this.store.get(this.key(ctx, id)) ?? null; }
  async findByCampaign(ctx: OutreachRepositoryContext, id: CampaignId): Promise<OutreachSequence[]> { return [...this.store.values()].filter(s => s.tenantId === ctx.tenantId && s.workspaceId === ctx.workspaceId && s.campaignId === id); }
}
