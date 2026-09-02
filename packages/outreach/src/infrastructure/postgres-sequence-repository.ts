import type { Pool } from 'pg';
import { OutreachSequence } from '@projectx/domain';
import { ensureSameTenant, type TenantContext } from '@projectx/domain';
import type { Recipient, SequenceStatus, SequenceStep } from '@projectx/domain';
import type { CampaignId, LeadId, SequenceId, TenantId } from '@projectx/shared';
import { PostgresClient, PostgresRepository, toDate } from '@projectx/infrastructure';
import type { ISequenceRepository } from '../ports/outreach-repository.interface';

export interface PostgresSequenceRepositoryConfig {
  pool: Pool;
}

export class PostgresSequenceRepository implements ISequenceRepository {
  private readonly repository: PostgresRepository<OutreachSequence, SequenceSnapshot, SequenceId>;
  private readonly client: PostgresClient;

  constructor(config: PostgresSequenceRepositoryConfig) {
    this.client = new PostgresClient(config.pool);
    this.repository = new PostgresRepository<OutreachSequence, SequenceSnapshot, SequenceId>(
      { pool: config.pool, tableName: 'outreach.sequences' },
      {
        toSnapshot: (entity) => ({
          id: entity.id,
          tenantId: entity.tenantId,
          campaignId: entity.campaignId,
          leadId: entity.leadId,
          recipient: entity.recipient,
          steps: entity.steps,
          status: entity.status,
          currentStepIndex: entity.currentStepIndex,
          nextDueAt: entity.nextDueAt,
          responseDeadlineAt: entity.responseDeadlineAt,
          workflowId: entity.workflowId,
          workflowStartedAt: entity.workflowStartedAt,
          createdAt: entity.createdAt,
          updatedAt: entity.updatedAt,
        }),
        fromSnapshot: (snapshot, id, tenantId, version) =>
          OutreachSequence.reconstitute(
            {
              ...snapshot,
              id,
              tenantId: tenantId as TenantId,
              leadId: snapshot.leadId as LeadId,
              recipient: snapshot.recipient as Recipient,
              steps: snapshot.steps as SequenceStep[],
              status: snapshot.status as SequenceStatus,
              nextDueAt: toDate(snapshot.nextDueAt),
              responseDeadlineAt: toDate(snapshot.responseDeadlineAt),
              workflowId: snapshot.workflowId,
              workflowStartedAt: toDate(snapshot.workflowStartedAt),
              createdAt: toDate(snapshot.createdAt),
              updatedAt: toDate(snapshot.updatedAt),
            },
            version,
          ),
      },
    );
  }

  async save(ctx: TenantContext, sequence: OutreachSequence): Promise<void> {
    ensureSameTenant(ctx, sequence.tenantId);
    await this.repository.save(ctx, sequence);
  }

  async load(ctx: TenantContext, sequenceId: SequenceId): Promise<OutreachSequence | null> {
    return this.repository.findById(ctx, sequenceId);
  }

  async findByCampaign(ctx: TenantContext, campaignId: CampaignId): Promise<OutreachSequence[]> {
    const result = await this.client.withTenant(ctx, async (client) => {
      return client.query(
        `SELECT payload, version FROM outreach.sequences WHERE tenant_id = $1 AND campaign_id = $2`,
        [ctx.tenantId as string, campaignId],
      );
    });

    return result.rows.map((row) => {
      const snapshot = row.payload as SequenceSnapshot;
      return OutreachSequence.reconstitute(
        {
          ...snapshot,
          tenantId: ctx.tenantId as TenantId,
          leadId: snapshot.leadId as LeadId,
          recipient: snapshot.recipient as Recipient,
          steps: snapshot.steps as SequenceStep[],
          status: snapshot.status as SequenceStatus,
          nextDueAt: toDate(snapshot.nextDueAt),
          responseDeadlineAt: toDate(snapshot.responseDeadlineAt),
          workflowId: snapshot.workflowId,
          workflowStartedAt: toDate(snapshot.workflowStartedAt),
          createdAt: toDate(snapshot.createdAt),
          updatedAt: toDate(snapshot.updatedAt),
        },
        row.version as number,
      );
    });
  }
}

type SequenceSnapshot = {
  id?: SequenceId;
  tenantId?: string & { readonly __brand: 'TenantId' };
  campaignId: CampaignId;
  leadId: string;
  recipient: unknown;
  steps: unknown[];
  status: string;
  currentStepIndex: number;
  nextDueAt?: Date;
  responseDeadlineAt?: Date;
  workflowId?: string;
  workflowStartedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};
