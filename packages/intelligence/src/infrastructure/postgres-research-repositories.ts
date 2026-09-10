import type { Pool, PoolClient } from 'pg';
import { ResearchEvidence, ResearchRequest, ResearchRun, TenantIsolationError, AuthorizationError } from '@projectx/domain';
import { asAccountId, asContactId, asEvidenceId, asResearchRequestId, asResearchRunId, asTenantId } from '@projectx/shared';
import type { IResearchEvidenceRepository, IResearchLifecycleRepository, ResearchEvidenceRepositoryContext } from '@projectx/infrastructure';
import { DuplicateRecordError, PostgresClient } from '@projectx/infrastructure';

function assertOwnership(ctx: ResearchEvidenceRepositoryContext, tenantId: string, workspaceId: string, type: string): void {
  if (ctx.tenantId !== tenantId) throw new TenantIsolationError(`${type} tenant does not match context tenant`);
  if (ctx.workspaceId !== workspaceId) throw new AuthorizationError(`${type} workspace does not match authorized workspace`);
}

function rowToEvidence(row: Record<string, unknown>): ResearchEvidence {
  return new ResearchEvidence({
    evidenceId: asEvidenceId(row.evidence_id as string),
    tenantId: asTenantId(row.tenant_id as string),
    workspaceId: row.workspace_id as string,
    requestId: asResearchRequestId(row.request_id as string),
    runId: asResearchRunId(row.run_id as string),
    accountId: row.account_id ? asAccountId(row.account_id as string) : undefined,
    contactId: row.contact_id ? asContactId(row.contact_id as string) : undefined,
    missionId: row.mission_id as string | undefined,
    claimType: row.claim_type as string,
    normalizedValue: row.normalized_value as any,
    source: row.source as string,
    sourceUri: (row.source_uri as string | null) ?? undefined,
    reliabilityTier: row.reliability_tier as any,
    observedAt: new Date(row.observed_at as string | Date).toISOString(),
    freshnessExpiry: new Date(row.freshness_expiry as string | Date).toISOString(),
    confidence: Number(row.confidence),
    confidenceBreakdown: row.confidence_breakdown as any,
    provenance: row.provenance as any,
    contradictions: (row.contradictions ?? undefined) as any,
    evidenceFingerprint: row.evidence_fingerprint as string,
  });
}

export class PostgresResearchLifecycleRepository implements IResearchLifecycleRepository {
  private readonly client: PostgresClient;

  constructor(pool: Pool) {
    this.client = new PostgresClient(pool);
  }

  async saveRequest(ctx: ResearchEvidenceRepositoryContext, request: ResearchRequest): Promise<void> {
    assertOwnership(ctx, request.tenantId, request.workspaceId, 'ResearchRequest');
    await this.client.withTenant(ctx, (client: PoolClient) => client.query(
      `INSERT INTO intelligence.research_requests
       (request_id, tenant_id, workspace_id, mission_id, query_hash, requested_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [request.id, ctx.tenantId, ctx.workspaceId, request.missionId ?? null, request.queryHash, request.requestedAt],
    ));
  }

  async findRequest(ctx: ResearchEvidenceRepositoryContext, requestId: string): Promise<ResearchRequest | null> {
    return this.client.withTenant(ctx, async (client: PoolClient) => {
      const result = await client.query(
        `SELECT * FROM intelligence.research_requests
         WHERE tenant_id = $1 AND workspace_id = $2 AND request_id = $3 LIMIT 1`,
        [ctx.tenantId, ctx.workspaceId, requestId],
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return ResearchRequest.create({
        id: asResearchRequestId(row.request_id), tenantId: asTenantId(row.tenant_id), workspaceId: row.workspace_id,
        missionId: row.mission_id ?? undefined, queryHash: row.query_hash,
        requestedAt: new Date(row.requested_at).toISOString(),
      });
    });
  }

  async saveRun(ctx: ResearchEvidenceRepositoryContext, run: ResearchRun): Promise<void> {
    assertOwnership(ctx, run.tenantId, run.workspaceId, 'ResearchRun');
    await this.client.withTenant(ctx, (client: PoolClient) => client.query(
      `INSERT INTO intelligence.research_runs
       (run_id, tenant_id, workspace_id, request_id, status, started_at, completed_at, failure_code, failure_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (run_id) DO UPDATE SET status = EXCLUDED.status, started_at = EXCLUDED.started_at,
         completed_at = EXCLUDED.completed_at, failure_code = EXCLUDED.failure_code, failure_message = EXCLUDED.failure_message
       WHERE intelligence.research_runs.tenant_id = EXCLUDED.tenant_id
         AND intelligence.research_runs.workspace_id = EXCLUDED.workspace_id`,
      [run.id, ctx.tenantId, ctx.workspaceId, run.requestId, run.status, run.startedAt ?? null,
        run.completedAt ?? null, run.failureCode ?? null, run.failureMessage ?? null],
    ));
  }

  async findRun(ctx: ResearchEvidenceRepositoryContext, runId: string): Promise<ResearchRun | null> {
    return this.client.withTenant(ctx, async (client: PoolClient) => {
      const result = await client.query(
        `SELECT * FROM intelligence.research_runs
         WHERE tenant_id = $1 AND workspace_id = $2 AND run_id = $3 LIMIT 1`,
        [ctx.tenantId, ctx.workspaceId, runId],
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return ResearchRun.reconstitute({
        id: asResearchRunId(row.run_id), tenantId: asTenantId(row.tenant_id), workspaceId: row.workspace_id,
        requestId: asResearchRequestId(row.request_id), status: row.status,
        startedAt: row.started_at ? new Date(row.started_at).toISOString() : undefined,
        completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : undefined,
        failureCode: row.failure_code ?? undefined, failureMessage: row.failure_message ?? undefined,
      });
    });
  }
}

export class PostgresResearchEvidenceRepository implements IResearchEvidenceRepository {
  private readonly client: PostgresClient;

  constructor(pool: Pool) {
    this.client = new PostgresClient(pool);
  }

  async save(ctx: ResearchEvidenceRepositoryContext, evidence: ResearchEvidence): Promise<void> {
    assertOwnership(ctx, evidence.tenantId, evidence.workspaceId, 'ResearchEvidence');
    const p = evidence.props;
    try {
      await this.client.withTenant(ctx, (client: PoolClient) => client.query(
        `INSERT INTO intelligence.research_evidence
         (evidence_id,tenant_id,workspace_id,request_id,run_id,account_id,contact_id,mission_id,
          claim_type,normalized_value,source,source_uri,reliability_tier,observed_at,freshness_expiry,
          confidence,confidence_breakdown,provenance,contradictions,evidence_fingerprint)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [p.evidenceId,p.tenantId,p.workspaceId,p.requestId,p.runId,p.accountId ?? null,p.contactId ?? null,p.missionId ?? null,
          p.claimType,JSON.stringify(p.normalizedValue),p.source,p.sourceUri ?? null,p.reliabilityTier,p.observedAt,p.freshnessExpiry,
          p.confidence,JSON.stringify(p.confidenceBreakdown),JSON.stringify(p.provenance),p.contradictions ? JSON.stringify(p.contradictions) : null,p.evidenceFingerprint],
      ));
    } catch (err) {
      const pgErr = err as { code?: string; constraint?: string };
      if (pgErr.code === '23505') {
        throw new DuplicateRecordError(`Duplicate research evidence ${p.evidenceId}`, ctx.tenantId as string, p.evidenceId as string, 'evidence_fingerprint');
      }
      throw new Error(`Persistence failure for research evidence ${p.evidenceId}`);
    }
  }

  async findById(ctx: ResearchEvidenceRepositoryContext, id: string): Promise<ResearchEvidence | null> {
    return this.findOne(ctx, 'evidence_id', id);
  }

  async findByFingerprint(ctx: ResearchEvidenceRepositoryContext, fingerprint: string): Promise<ResearchEvidence | null> {
    return this.findOne(ctx, 'evidence_fingerprint', fingerprint);
  }

  async findByAccount(ctx: ResearchEvidenceRepositoryContext, accountId: string): Promise<ResearchEvidence[]> {
    return this.findMany(ctx, 'account_id', accountId);
  }

  async findByContact(ctx: ResearchEvidenceRepositoryContext, contactId: string): Promise<ResearchEvidence[]> {
    return this.findMany(ctx, 'contact_id', contactId);
  }

  async findByMission(ctx: ResearchEvidenceRepositoryContext, missionId: string): Promise<ResearchEvidence[]> {
    return this.findMany(ctx, 'mission_id', missionId);
  }

  private async findOne(ctx: ResearchEvidenceRepositoryContext, column: 'evidence_id' | 'evidence_fingerprint', value: string): Promise<ResearchEvidence | null> {
    const rows = await this.query(ctx, column, value, true);
    return rows.length > 0 ? rowToEvidence(rows[0]) : null;
  }

  private async findMany(ctx: ResearchEvidenceRepositoryContext, column: 'account_id' | 'contact_id' | 'mission_id', value: string): Promise<ResearchEvidence[]> {
    return (await this.query(ctx, column, value, false)).map(rowToEvidence);
  }

  private async query(ctx: ResearchEvidenceRepositoryContext, column: string, value: string, limit: boolean): Promise<Record<string, unknown>[]> {
    const allowed = new Set(['evidence_id', 'evidence_fingerprint', 'account_id', 'contact_id', 'mission_id']);
    if (!allowed.has(column)) throw new Error('Unsupported research evidence query');
    return this.client.withTenant(ctx, async (client: PoolClient) => {
      const result = await client.query(
        `SELECT * FROM intelligence.research_evidence WHERE tenant_id = $1 AND workspace_id = $2 AND ${column} = $3${limit ? ' LIMIT 1' : ''}`,
        [ctx.tenantId, ctx.workspaceId, value],
      );
      return result.rows;
    });
  }
}
