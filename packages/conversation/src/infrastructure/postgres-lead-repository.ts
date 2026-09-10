import type { Pool, PoolClient } from 'pg';
import { Lead, TenantIsolationError } from '@projectx/domain';
import type { LeadScores, LeadStatus, TenantContext } from '@projectx/domain';
import type { LeadId, AccountId, ContactId, ICPProfileId, ICPProfileVersionId, EvidenceId } from '@projectx/shared';
import { asLeadId, asTenantId, asAccountId, asContactId, asICPProfileId, asICPProfileVersionId, asEvidenceId } from '@projectx/shared';
import type { ILeadRepository } from '../ports/lead-repository.interface';
import { PostgresClient, ConcurrencyConflictError, toRequiredDate } from '@projectx/infrastructure';

function rowToLead(row: Record<string, unknown>): Lead {
  return Lead.reconstitute(
    {
      id: asLeadId(row.id as string),
      tenantId: asTenantId(row.tenant_id as string),
      workspaceId: row.workspace_id as string,
      accountId: asAccountId(row.account_id as string),
      contactId: asContactId(row.contact_id as string),
      icpProfileId: asICPProfileId(row.icp_profile_id as string),
      icpProfileVersionId: asICPProfileVersionId(row.icp_profile_version_id as string),
      missionId: row.mission_id as string | undefined,
      scores: row.scores as LeadScores | undefined,
      status: row.status as LeadStatus,
      decisionReason: row.decision_reason as string | undefined,
      reasonCodes: (row.reason_codes as string[]) ?? [],
      qualificationSnapshot: row.qualification_snapshot as any,
      evidenceReferences: ((row.evidence_references as string[]) ?? []).map(asEvidenceId),
      createdAt: toRequiredDate(row.created_at as string | Date),
      updatedAt: toRequiredDate(row.updated_at as string | Date),
    },
    row.version as number,
  );
}

const FIND_BY_ID_SQL = `
  SELECT *
  FROM intelligence.leads
  WHERE tenant_id = $1 AND id = $2
  LIMIT 1
`;

const INSERT_SQL = `
  INSERT INTO intelligence.leads (
    tenant_id, workspace_id, id, account_id, contact_id,
    icp_profile_id, icp_profile_version_id, status, decision_reason,
    reason_codes, scores, qualification_snapshot, evidence_references,
    mission_id, version, created_at, updated_at
  ) VALUES (
    $1, $2, $3, $4, $5,
    $6, $7, $8, $9,
    $10, $11, $12, $13,
    $14, $15, $16, $17
  )
`;

const UPDATE_SQL = `
  UPDATE intelligence.leads SET
    account_id = $3,
    contact_id = $4,
    icp_profile_id = $5,
    icp_profile_version_id = $6,
    status = $7,
    decision_reason = $8,
    reason_codes = $9,
    scores = $10,
    qualification_snapshot = $11,
    evidence_references = $12,
    mission_id = $13,
    version = $14,
    updated_at = $15
  WHERE tenant_id = $1 AND id = $2 AND version = $16
`;

export interface PostgresLeadRepositoryConfig {
  pool: Pool;
}

export class PostgresLeadRepository implements ILeadRepository {
  private readonly client: PostgresClient;

  constructor(config: PostgresLeadRepositoryConfig) {
    this.client = new PostgresClient(config.pool);
  }

  async load(ctx: TenantContext, id: LeadId): Promise<Lead | null> {
    return this.client.withTenant(ctx, async (client: PoolClient) => {
      const result = await client.query(FIND_BY_ID_SQL, [ctx.tenantId, id]);
      if (result.rows.length === 0) return null;
      return rowToLead(result.rows[0]);
    });
  }

  async save(ctx: TenantContext, lead: Lead): Promise<void> {
    if (ctx.tenantId !== lead.tenantId) {
      throw new TenantIsolationError(
        `Lead tenant ${lead.tenantId} does not match context tenant ${ctx.tenantId}`,
      );
    }

    const isNew = lead.loadedVersion === undefined;
    await this.client.withTenant(ctx, async (client: PoolClient) => {
      if (isNew) {
        await this.insert(client, ctx, lead);
      } else {
        await this.update(client, ctx, lead);
      }
    });

    lead.setVersion(lead.version);
  }

  private async insert(client: PoolClient, ctx: TenantContext, lead: Lead): Promise<void> {
    const params = [
      ctx.tenantId,
      lead.workspaceId,
      lead.id,
      lead.accountId,
      lead.contactId,
      lead.icpProfileId,
      lead.icpProfileVersionId,
      lead.status,
      lead.decisionReason ?? null,
      lead.reasonCodes,
      lead.scores ? JSON.stringify(lead.scores) : null,
      lead.qualificationSnapshot ? JSON.stringify(lead.qualificationSnapshot) : null,
      lead.evidenceReferences,
      lead.missionId ?? null,
      lead.version,
      lead.createdAt,
      lead.updatedAt,
    ];
    try {
      await client.query(INSERT_SQL, params);
    } catch (err) {
      const pgErr = err as { code?: string; constraint?: string };
      if (pgErr.code === '23505' && pgErr.constraint === 'leads_pkey') {
        throw new ConcurrencyConflictError(
          `Lead ${lead.id} already exists`,
          ctx.tenantId as string,
          lead.id as string,
          undefined,
        );
      }
      throw new Error(`Persistence failure for lead ${lead.id}`);
    }
  }

  private async update(client: PoolClient, ctx: TenantContext, lead: Lead): Promise<void> {
    const expectedVersion = lead.loadedVersion!;
    const params = [
      ctx.tenantId,
      lead.id,
      lead.accountId,
      lead.contactId,
      lead.icpProfileId,
      lead.icpProfileVersionId,
      lead.status,
      lead.decisionReason ?? null,
      lead.reasonCodes,
      lead.scores ? JSON.stringify(lead.scores) : null,
      lead.qualificationSnapshot ? JSON.stringify(lead.qualificationSnapshot) : null,
      lead.evidenceReferences,
      lead.missionId ?? null,
      lead.version,
      lead.updatedAt,
      expectedVersion,
    ];
    let result;
    try {
      result = await client.query(UPDATE_SQL, params);
    } catch (err) {
      throw new Error(`Persistence failure for lead ${lead.id}`);
    }
    if (result.rowCount === 0) {
      throw new ConcurrencyConflictError(
        `Stale version for lead ${lead.id}: expected ${expectedVersion}`,
        ctx.tenantId as string,
        lead.id as string,
        expectedVersion,
      );
    }
  }
}
