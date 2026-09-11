import { AuthorizationError, TenantIsolationError, type OutreachCampaign } from '@projectx/domain';
import type { CampaignId } from '@projectx/shared';
import type { ICampaignRepository, OutreachRepositoryContext } from '../ports/outreach-repository.interface';

export class InMemoryCampaignRepository implements ICampaignRepository {
  private readonly store = new Map<string, OutreachCampaign>();
  private key(ctx: OutreachRepositoryContext, id: string): string { return `${ctx.tenantId}:${ctx.workspaceId}:${id}`; }
  async save(ctx: OutreachRepositoryContext, campaign: OutreachCampaign): Promise<void> {
    if (campaign.tenantId !== ctx.tenantId) throw new TenantIsolationError('Campaign tenant mismatch');
    if (campaign.workspaceId !== ctx.workspaceId) throw new AuthorizationError('Campaign workspace mismatch');
    this.store.set(this.key(ctx, campaign.id), campaign);
  }
  async load(ctx: OutreachRepositoryContext, id: CampaignId): Promise<OutreachCampaign | null> { return this.store.get(this.key(ctx, id)) ?? null; }
}
