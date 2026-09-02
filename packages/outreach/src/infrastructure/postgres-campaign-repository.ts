import type { Pool } from 'pg';
import { OutreachCampaign } from '@projectx/domain';
import { ensureSameTenant, type TenantContext } from '@projectx/domain';
import type { CampaignBudget, CampaignStatus } from '@projectx/domain';
import type { OutreachChannel } from '@projectx/domain';
import type { Recipient } from '@projectx/domain';
import type { SequenceStep } from '@projectx/domain';
import type { CampaignId, LeadId, TenantId } from '@projectx/shared';
import { PostgresRepository, toDate } from '@projectx/infrastructure';
import type { ICampaignRepository } from '../ports/outreach-repository.interface';

export interface PostgresCampaignRepositoryConfig {
  pool: Pool;
}

export class PostgresCampaignRepository implements ICampaignRepository {
  private readonly repository: PostgresRepository<OutreachCampaign, CampaignSnapshot, CampaignId>;

  constructor(config: PostgresCampaignRepositoryConfig) {
    this.repository = new PostgresRepository<OutreachCampaign, CampaignSnapshot, CampaignId>(
      { pool: config.pool, tableName: 'outreach.campaigns' },
      {
        toSnapshot: (entity) => ({
          id: entity.id,
          tenantId: entity.tenantId,
          missionId: entity.missionId,
          leadId: entity.leadId,
          recipient: entity.recipient,
          channel: entity.channel,
          steps: entity.steps,
          budget: entity.budget,
          status: entity.status,
          sentCount: entity.sentCount,
          spentCostUsd: entity.spentCostUsd,
          createdAt: entity.createdAt,
          updatedAt: entity.updatedAt,
        }),
        fromSnapshot: (snapshot, id, tenantId, version) =>
          OutreachCampaign.reconstitute(
            {
              ...snapshot,
              id,
              tenantId: tenantId as TenantId,
              leadId: snapshot.leadId as LeadId,
              recipient: snapshot.recipient as Recipient,
              channel: snapshot.channel as OutreachChannel,
              steps: snapshot.steps as SequenceStep[],
              budget: snapshot.budget as CampaignBudget | undefined,
              status: snapshot.status as CampaignStatus,
              createdAt: toDate(snapshot.createdAt),
              updatedAt: toDate(snapshot.updatedAt),
            },
            version,
          ),
      },
    );
  }

  async save(ctx: TenantContext, campaign: OutreachCampaign): Promise<void> {
    ensureSameTenant(ctx, campaign.tenantId);
    await this.repository.save(ctx, campaign);
  }

  async load(ctx: TenantContext, campaignId: CampaignId): Promise<OutreachCampaign | null> {
    return this.repository.findById(ctx, campaignId);
  }
}

type CampaignSnapshot = {
  id?: CampaignId;
  tenantId?: string & { readonly __brand: 'TenantId' };
  missionId?: string;
  leadId: string;
  recipient: unknown;
  channel: string;
  steps: unknown[];
  budget?: unknown;
  status: string;
  sentCount: number;
  spentCostUsd: number;
  createdAt: Date;
  updatedAt: Date;
};
