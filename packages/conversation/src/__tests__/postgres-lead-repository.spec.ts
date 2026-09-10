import type { Pool, PoolClient } from 'pg';
import { Lead } from '@projectx/domain';
import {
  asAccountId,
  asContactId,
  asCorrelationId,
  asEventId,
  asICPProfileId,
  asICPProfileVersionId,
  asLeadId,
  asTenantId,
} from '@projectx/shared';
import { PostgresLeadRepository } from '../infrastructure/postgres-lead-repository';

// Minimal in-memory PoolClient/Pool double for the Lead repository's SQL.
// The real behavior is proven against live PostgreSQL in the Slice 8 E2E suite.
class FakePoolClient {
  readonly queries: Array<{ sql: string; params: unknown[] }> = [];
  private stored: Record<string, unknown> | null = null;

  async query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
    this.queries.push({ sql, params: params ?? [] });

    if (/set_config/i.test(sql)) {
      return { rows: [{ set_config: params?.[0] }], rowCount: 1 };
    }

    if (/INSERT INTO intelligence\.leads/i.test(sql)) {
      // Map params to a synthetic row. Param order is defined in INSERT_SQL.
      const p = params ?? [];
      this.stored = {
        tenant_id: p[0],
        workspace_id: p[1],
        id: p[2],
        account_id: p[3],
        contact_id: p[4],
        icp_profile_id: p[5],
        icp_profile_version_id: p[6],
        status: p[7],
        decision_reason: p[8],
        reason_codes: p[9],
        scores: p[10] ? JSON.parse(p[10] as string) : null,
        qualification_snapshot: p[11] ? JSON.parse(p[11] as string) : null,
        evidence_references: p[12],
        mission_id: p[13],
        version: p[14],
        created_at: p[15],
        updated_at: p[16],
      };
      return { rows: [{ id: p[2] }], rowCount: 1 };
    }

    if (/SELECT/i.test(sql) && this.stored) {
      const tenantParam = (params ?? [])[0];
      if (this.stored.tenant_id === tenantParam) {
        return { rows: [this.stored], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (/UPDATE/i.test(sql) && this.stored) {
      const expectedVersion = (params ?? [])[15];
      if (this.stored.version !== expectedVersion) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [{ id: this.stored.id }], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  }

  release(): void {}
}

class FakePool {
  private readonly client = new FakePoolClient();

  async connect(): Promise<PoolClient> {
    return this.client as unknown as PoolClient;
  }

  async query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
    return this.client.query(sql, params);
  }

  async end(): Promise<void> {}
}

describe('PostgresLeadRepository', () => {
  const tenantId = asTenantId('tenant-1');
  const workspaceId = 'workspace-1';
  const ctx = { tenantId, correlationId: asCorrelationId('corr-1') };
  const FIXED_DATE = new Date('2025-01-15T12:00:00.000Z');

  function makeLead() {
    return Lead.create(
      {
        id: asLeadId('lead-1'),
        tenantId,
        workspaceId,
        accountId: asAccountId('acc-1'),
        contactId: asContactId('contact-1'),
        icpProfileId: asICPProfileId('icp-1'),
        icpProfileVersionId: asICPProfileVersionId('icp-v1'),
      },
      asCorrelationId('corr-1'),
      asEventId('evt-1'),
    );
  }

  function evaluate(lead: Lead) {
    const result = lead.evaluate(
      {
        scores: { icpMatch: 0.9, signalScore: 0.8, intentScore: 0.7, evidenceConfidence: 0.9, overall: 0.85 },
        qualificationThreshold: 0.75,
        reviewThreshold: 0.55,
        hardFilterResults: [],
        evidenceIds: [],
        signalIds: [],
        normalizedFeatures: { industry: 'software', employeeCount: 100, territories: [] },
        snapshotSchemaVersion: '1.0',
        scoringPolicyVersion: '1.0',
        algorithmVersion: '1.0',
        evaluatedAt: FIXED_DATE,
      },
      asCorrelationId('c2'),
      asEventId('e2'),
    );
    expect(result.success).toBe(true);
  }

  it('persists and reconstitutes a lead with workspace, ICP version, and qualification snapshot', async () => {
    const repo = new PostgresLeadRepository({ pool: new FakePool() as unknown as Pool });
    const lead = makeLead();
    evaluate(lead);

    await repo.save(ctx, lead);
    const reloaded = await repo.load(ctx, lead.id);

    expect(reloaded).not.toBeNull();
    expect(reloaded!.status).toBe('QUALIFIED');
    expect(reloaded!.scores.overall).toBeCloseTo(0.85);
    expect(reloaded!.workspaceId).toBe(workspaceId);
    expect(reloaded!.icpProfileVersionId).toBe('icp-v1');
    expect(reloaded!.qualificationSnapshot).toBeDefined();
    expect(reloaded!.qualificationSnapshot!.icpProfileVersionId).toBe('icp-v1');
    expect(reloaded!.qualificationSnapshot!.evaluatedAt).toBe(FIXED_DATE.toISOString());
  });

  it('does not return a lead belonging to another tenant', async () => {
    const pool = new FakePool();
    const repo = new PostgresLeadRepository({ pool: pool as unknown as Pool });
    const lead = makeLead();
    await repo.save(ctx, lead);

    const otherCtx = { tenantId: asTenantId('tenant-2'), correlationId: asCorrelationId('c') };
    const result = await repo.load(otherCtx, lead.id);
    expect(result).toBeNull();
  });
});
