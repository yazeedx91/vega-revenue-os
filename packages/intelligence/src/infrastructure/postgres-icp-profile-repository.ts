import type { Pool, PoolClient } from 'pg';
import { ICPProfile, TenantIsolationError, AuthorizationError } from '@projectx/domain';
import { asICPProfileId, asICPProfileVersionId, asTenantId } from '@projectx/shared';
import type { ICPProfileRepositoryContext, IICPProfileRepository } from '@projectx/infrastructure';
import { PostgresClient, ConcurrencyConflictError, toRequiredDate } from '@projectx/infrastructure';

function toNumber(value: unknown): number {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error('Invalid numeric value in ICP profile row');
  return result;
}

function rowToICPProfile(row: Record<string, unknown>): ICPProfile {
  return ICPProfile.reconstitute(
    {
      id: asICPProfileId(row.icp_profile_id as string),
      versionId: asICPProfileVersionId(row.icp_profile_version_id as string),
      version: row.version_number as number,
      tenantId: asTenantId(row.tenant_id as string),
      workspaceId: row.workspace_id as string,
      name: row.name as string,
      hardFilters: row.hard_filters as any,
      softCriteria: row.soft_criteria as any,
      positiveSignals: (row.positive_signals as string[]) ?? [],
      negativeSignals: (row.negative_signals as string[]) ?? [],
      disqualifiers: (row.disqualifiers as string[]) ?? [],
      scoringWeights: row.scoring_weights as any,
      qualificationThreshold: toNumber(row.qualification_threshold),
      reviewThreshold: toNumber(row.review_threshold),
      minimumConfidence: toNumber(row.minimum_confidence),
      status: row.status as any,
      createdAt: toRequiredDate(row.created_at as string | Date),
    },
    row.version_number as number,
  );
}

const FIND_BY_ID_SQL = `
  SELECT * FROM intelligence.icp_profiles
  WHERE tenant_id = $1 AND workspace_id = $2 AND icp_profile_id = $3
  ORDER BY version_number DESC
  LIMIT 1
`;

const FIND_BY_VERSION_ID_SQL = `
  SELECT * FROM intelligence.icp_profiles
  WHERE tenant_id = $1 AND workspace_id = $2 AND icp_profile_version_id = $3
  LIMIT 1
`;

const FIND_ACTIVE_SQL = `
  SELECT * FROM intelligence.icp_profiles
  WHERE tenant_id = $1 AND workspace_id = $2 AND status = 'ACTIVE'
  ORDER BY version_number DESC
  LIMIT 1
`;

const INSERT_SQL = `
  INSERT INTO intelligence.icp_profiles (
    icp_profile_version_id, icp_profile_id, version_number, tenant_id,
    workspace_id, name, hard_filters, soft_criteria, positive_signals,
    negative_signals, disqualifiers, scoring_weights,
    qualification_threshold, review_threshold, minimum_confidence,
    status, created_at
  ) VALUES (
    $1, $2, $3, $4,
    $5, $6, $7, $8, $9,
    $10, $11, $12,
    $13, $14, $15,
    $16, $17
  )
`;

export class PostgresICPProfileRepository implements IICPProfileRepository {
  private readonly client: PostgresClient;

  constructor(pool: Pool) {
    this.client = new PostgresClient(pool);
  }

  async findById(ctx: ICPProfileRepositoryContext, id: string): Promise<ICPProfile | null> {
    return this.client.withTenant(ctx, async (client: PoolClient) => {
      const result = await client.query(FIND_BY_ID_SQL, [ctx.tenantId, ctx.workspaceId, id]);
      return result.rows.length > 0 ? rowToICPProfile(result.rows[0]) : null;
    });
  }

  async findByVersionId(ctx: ICPProfileRepositoryContext, versionId: string): Promise<ICPProfile | null> {
    return this.client.withTenant(ctx, async (client: PoolClient) => {
      const result = await client.query(FIND_BY_VERSION_ID_SQL, [ctx.tenantId, ctx.workspaceId, versionId]);
      return result.rows.length > 0 ? rowToICPProfile(result.rows[0]) : null;
    });
  }

  async findActiveByWorkspace(ctx: ICPProfileRepositoryContext): Promise<ICPProfile | null> {
    return this.client.withTenant(ctx, async (client: PoolClient) => {
      const result = await client.query(FIND_ACTIVE_SQL, [ctx.tenantId, ctx.workspaceId]);
      return result.rows.length > 0 ? rowToICPProfile(result.rows[0]) : null;
    });
  }

  async save(ctx: ICPProfileRepositoryContext, profile: ICPProfile): Promise<void> {
    if (ctx.tenantId !== profile.tenantId) {
      throw new TenantIsolationError(
        `ICP profile tenant ${profile.tenantId} does not match context tenant ${ctx.tenantId}`,
      );
    }
    if (ctx.workspaceId !== profile.workspaceId) {
      throw new AuthorizationError(
        `ICP profile workspace ${profile.workspaceId} does not match authorized workspace ${ctx.workspaceId}`,
      );
    }

    const current = await this.findById(ctx, profile.id as string);
    if (current && profile.versionNumber !== current.versionNumber + 1) {
      throw new ConcurrencyConflictError(
        `ICP profile ${profile.id} version must increase monotonically from ${current.versionNumber} to ${current.versionNumber + 1}`,
        ctx.tenantId as string,
        profile.id as string,
        current.versionNumber,
      );
    }

    await this.client.withTenant(ctx, async (client: PoolClient) => {
      try {
        await client.query(INSERT_SQL, [
          profile.versionId,
          profile.id,
          profile.versionNumber,
          ctx.tenantId,
          ctx.workspaceId,
          profile.name,
          JSON.stringify(profile.hardFilters),
          JSON.stringify(profile.softCriteria),
          profile.positiveSignals,
          profile.negativeSignals,
          profile.disqualifiers,
          JSON.stringify(profile.scoringWeights),
          profile.qualificationThreshold,
          profile.reviewThreshold,
          profile.minimumConfidence,
          profile.status,
          profile.createdAt,
        ]);
      } catch (err) {
        const pgErr = err as { code?: string; constraint?: string };
        if (pgErr.code === '23505') {
          throw new ConcurrencyConflictError(
            `ICP profile physical version ${profile.versionId} already exists or version is stale`,
            ctx.tenantId as string,
            profile.id as string,
            current?.versionNumber,
          );
        }
        throw new Error(`Persistence failure for ICP profile ${profile.id}`);
      }
    });
  }
}
