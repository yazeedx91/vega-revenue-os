import type { Pool } from 'pg';
import { Lead } from '@projectx/domain';
import type { LeadScores, LeadStatus, TenantContext } from '@projectx/domain';
import { ensureSameTenant } from '@projectx/domain';
import type { AccountId, ContactId, EvidenceId, ICPProfileId, LeadId, TenantId } from '@projectx/shared';
import { PostgresRepository, toDate } from '@projectx/infrastructure';
import type { ILeadRepository } from '../ports/lead-repository.interface';

export interface PostgresLeadRepositoryConfig {
  pool: Pool;
}

type LeadSnapshot = {
  id?: LeadId;
  tenantId?: string & { readonly __brand: 'TenantId' };
  missionId?: string;
  accountId: string;
  contactId: string;
  icpProfileId: string;
  scores: unknown;
  status: string;
  decisionReason?: string;
  evidenceReferences: string[];
  createdAt: Date;
  updatedAt: Date;
};

export class PostgresLeadRepository implements ILeadRepository {
  private readonly repository: PostgresRepository<Lead, LeadSnapshot, LeadId>;

  constructor(config: PostgresLeadRepositoryConfig) {
    this.repository = new PostgresRepository<Lead, LeadSnapshot, LeadId>(
      { pool: config.pool, tableName: 'intelligence.leads' },
      {
        toSnapshot: (entity) => ({
          id: entity.id,
          tenantId: entity.tenantId,
          missionId: entity.missionId,
          accountId: entity.accountId,
          contactId: entity.contactId,
          icpProfileId: entity.icpProfileId,
          scores: entity.scores,
          status: entity.status,
          decisionReason: entity.decisionReason,
          evidenceReferences: entity.evidenceReferences as string[],
          createdAt: entity.createdAt,
          updatedAt: entity.updatedAt,
        }),
        fromSnapshot: (snapshot, id, tenantId, version) =>
          Lead.reconstitute(
            {
              ...snapshot,
              id,
              tenantId: tenantId as TenantId,
              accountId: snapshot.accountId as AccountId,
              contactId: snapshot.contactId as ContactId,
              icpProfileId: snapshot.icpProfileId as ICPProfileId,
              scores: snapshot.scores as LeadScores,
              status: snapshot.status as LeadStatus,
              evidenceReferences: snapshot.evidenceReferences as EvidenceId[],
              createdAt: toDate(snapshot.createdAt),
              updatedAt: toDate(snapshot.updatedAt),
            },
            version,
          ),
      },
    );
  }

  async load(ctx: TenantContext, id: LeadId): Promise<Lead | null> {
    return this.repository.findById(ctx, id);
  }

  async save(ctx: TenantContext, lead: Lead): Promise<void> {
    ensureSameTenant(ctx, lead.tenantId);
    await this.repository.save(ctx, lead);
  }
}
