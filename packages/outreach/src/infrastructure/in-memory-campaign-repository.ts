import type { OutreachCampaign } from '@projectx/domain';
import { ensureSameTenant, type TenantContext } from '@projectx/domain';
import type { CampaignId } from '@projectx/shared';
import type { ICampaignRepository } from '../ports/outreach-repository.interface';

export class InMemoryCampaignRepository implements ICampaignRepository {
  private readonly store = new Map<string, OutreachCampaign>();

  private key(tenantId: string, campaignId: string): string {
    return `${tenantId}:${campaignId}`;
  }

  async save(ctx: TenantContext, campaign: OutreachCampaign): Promise<void> {
    ensureSameTenant(ctx, campaign.tenantId);
    this.store.set(this.key(ctx.tenantId as string, campaign.id as string), campaign);
  }

  async load(ctx: TenantContext, campaignId: CampaignId): Promise<OutreachCampaign | null> {
    for (const campaign of this.store.values()) {
      if (campaign.id === campaignId) {
        ensureSameTenant(ctx, campaign.tenantId);
        return campaign;
      }
    }
    return null;
  }
}
