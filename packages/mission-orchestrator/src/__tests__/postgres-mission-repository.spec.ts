import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { Actor, Mission, type TenantId } from '@projectx/domain';
import { asCorrelationId, asEventId, asMissionId, asTenantId, asUserId } from '@projectx/shared';
import {
  DEFAULT_ADMIN_DATABASE_URL,
  getAdminDatabaseUrl,
  getAppDatabaseUrl,
} from '../../../../tests/e2e/phase14/integration-config';
import { PostgresMissionRepository } from '../infrastructure/postgres-mission-repository';

async function runMigrations(connectionString: string): Promise<void> {
  const { main } = await import('../../../../infra/database/migrations/run');
  process.env.DATABASE_URL = connectionString;
  await main();
}

async function isReachable(connectionString: string): Promise<boolean> {
  let pool: Pool | undefined;
  try {
    const parsed = new URL(connectionString);
    pool = new Pool({
      host: '127.0.0.1',
      port: Number(parsed.port || 5432),
      user: decodeURIComponent(parsed.username || 'projectx'),
      password: decodeURIComponent(parsed.password || 'projectx'),
      database: (parsed.pathname || '/projectx').slice(1) || 'projectx',
      connectionTimeoutMillis: 2000,
    });
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool?.end();
  }
}

describe('PostgresMissionRepository', () => {
  let pool: Pool | undefined;
  let adminPool: Pool | undefined;
  let repo: PostgresMissionRepository | undefined;

  beforeAll(async () => {
    process.env.ADMIN_DATABASE_URL = DEFAULT_ADMIN_DATABASE_URL;
    const adminConnectionString = getAdminDatabaseUrl();
    if (!(await isReachable(adminConnectionString))) {
      // eslint-disable-next-line no-console
      console.warn(`Skipping PostgresMissionRepository tests: ${adminConnectionString} unreachable`);
      return;
    }

    await runMigrations(adminConnectionString);

    const appConnectionString = getAppDatabaseUrl();
    const adminParsed = new URL(adminConnectionString);
    adminPool = new Pool({
      host: '127.0.0.1',
      port: Number(adminParsed.port || 5432),
      user: decodeURIComponent(adminParsed.username || 'projectx'),
      password: decodeURIComponent(adminParsed.password || 'projectx'),
      database: (adminParsed.pathname || '/projectx').slice(1) || 'projectx',
    });

    const parsed = new URL(appConnectionString);
    pool = new Pool({
      host: '127.0.0.1',
      port: Number(parsed.port || 5432),
      user: decodeURIComponent(parsed.username || 'projectx_app'),
      password: decodeURIComponent(parsed.password || 'projectx_app'),
      database: (parsed.pathname || '/projectx').slice(1) || 'projectx',
    });
    repo = new PostgresMissionRepository({ pool });
  }, 60_000);

  beforeEach(async () => {
    if (!adminPool) return;
    await adminPool.query(
      `TRUNCATE TABLE mission.missions, mission.plans, mission.tasks, mission.task_dependencies, mission.task_execution_state, mission.observations, mission.workflow_identity CASCADE`,
    );
  }, 30_000);

  afterAll(async () => {
    await pool?.end();
    await adminPool?.end();
  });

  function makeTenantId(): TenantId {
    return asTenantId(`tenant-repo-${randomUUID()}`);
  }

  function makeCtx(tenantId: TenantId) {
    return { tenantId, correlationId: asCorrelationId('corr-repo-test') };
  }

  function makeMission(tenantId: TenantId, missionId: string) {
    const result = Mission.create(
      {
        id: asMissionId(missionId),
        tenantId,
        name: 'Research Mission',
        objective: 'find qualified prospects',
        icpId: 'icp-1',
        territory: ['US'],
        channels: ['email'],
        budget: { maxAiCostUsd: 100 },
        autonomyLevel: 0.5,
        constraints: {},
        successCriteria: { targetMeetings: 1 },
        deadline: new Date(Date.now() + 86_400_000),
        ownerUserId: asUserId(randomUUID()),
        plan: {
          planId: `${missionId}-plan`,
          version: 1,
          objectives: [],
          phases: [],
          approvalGates: [],
          fallbackBranches: [],
        },
      },
      asCorrelationId('corr-create'),
      asEventId('evt-create'),
    );
    if (!result.success) throw new Error(result.error.message);
    return result.value;
  }

  it('preserves status, deadline, budget and approvals across save/reload', async () => {
    if (!repo) return;
    const tenantId = makeTenantId();
    const ctx = makeCtx(tenantId);
    const id = randomUUID();
    const mission = makeMission(tenantId, id);
    const actor = Actor.human(asUserId(randomUUID()), tenantId);
    mission.approve(actor, asCorrelationId('c2'), asEventId('e2'));
    mission.start(asCorrelationId('c3'), asEventId('e3'));
    mission.planValid(asCorrelationId('c4'), asEventId('e4'));

    await repo.save(ctx, mission);
    const reloaded = await repo.findById(ctx, id);

    expect(reloaded).not.toBeNull();
    expect(reloaded!.status).toBe('EXECUTING');
    expect(reloaded!.budget.maxAiCostUsd).toBe(100);
    expect(reloaded!.approvals).toEqual([]);
    expect(Math.abs((reloaded!.deadline as Date).getTime() - mission.deadline.getTime())).toBeLessThan(1000);
    expect(reloaded!.createdAt).toBeInstanceOf(Date);
    expect(reloaded!.version).toBe(mission.version);
  });

  it('returns null when a mission does not exist', async () => {
    if (!repo) return;
    const tenantId = makeTenantId();
    const ctx = makeCtx(tenantId);
    const result = await repo.findById(ctx, randomUUID());
    expect(result).toBeNull();
  });

  it('rejects a stale-version save as a concurrency conflict', async () => {
    if (!repo) return;
    const tenantId = makeTenantId();
    const ctx = makeCtx(tenantId);
    const id = randomUUID();
    const mission = makeMission(tenantId, id);
    await repo.save(ctx, mission);

    const actor = Actor.human(asUserId(randomUUID()), tenantId);
    const loaderA = await repo.findById(ctx, id);
    const loaderB = await repo.findById(ctx, id);
    expect(loaderA).not.toBeNull();
    expect(loaderB).not.toBeNull();

    loaderA!.approve(actor, asCorrelationId('c-approve'), asEventId('e-approve'));
    await repo.save(ctx, loaderA!);

    loaderB!.cancel('stale', asCorrelationId('c-cancel'), asEventId('e-cancel'));
    await expect(repo.save(ctx, loaderB!)).rejects.toThrow();

    const winner = await repo.findById(ctx, id);
    expect(winner!.status).toBe('APPROVED');
  });
});
