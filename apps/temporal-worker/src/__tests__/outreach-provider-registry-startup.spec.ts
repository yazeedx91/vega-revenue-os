import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import type { TenantContext } from '@projectx/domain';
import type { TenantId } from '@projectx/shared';
import { createDurableAdapters, createOutreachExecutionService } from '../outreach-execution-service.factory';

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

describe('Outreach provider registry startup (integration)', () => {
  // Integration tests seed and read cross-tenant configuration, which requires the
  // admin/owner connection. The runtime factory reads DATABASE_URL internally.
  const databaseUrl = 'postgresql://projectx:projectx@localhost:5433/projectx';

  let pool: Pool | undefined;
  let tempTenantId: string | undefined;
  let adapters: Awaited<ReturnType<typeof createDurableAdapters>> | undefined;

  beforeEach(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.OUTREACH_LIVE_EMAIL_ENABLED = 'false';
    process.env.OUTREACH_MODE = 'ALLOWLIST_ONLY';
    process.env.GRAPH_TENANT_ID = 'test-tenant';
    process.env.GRAPH_CLIENT_ID = 'test-client';
    process.env.GRAPH_CLIENT_SECRET = 'test-secret';
    process.env.GRAPH_SENDER_ADDRESS = 'sender@example.com';

    if (!(await isReachable(databaseUrl))) {
      // eslint-disable-next-line no-console
      console.warn(`Skipping outreach provider registry startup tests: ${databaseUrl} unreachable`);
      return;
    }

    pool = new Pool({ connectionString: databaseUrl });
    tempTenantId = `tenant-registry-startup-${Date.now()}-${randomUUID()}`;

    await pool.query(
      `INSERT INTO outreach.tenant_email_config
       (tenant_id, provider_id, channel, from_address)
       VALUES ($1, $2, $3, $4)`,
      [tempTenantId, 'graph-email', 'email', 'sender@example.com'],
    );
  });

  afterEach(async () => {
    if (pool && tempTenantId) {
      await pool.query(
        'DELETE FROM outreach.tenant_email_config WHERE tenant_id = $1',
        [tempTenantId],
      );
      await pool.end();
    }
    await adapters?.dispose?.();
    adapters = undefined;
  });

  it('loads tenant email config from Postgres into the same registry used by execution', async () => {
    if (!pool) {
      return;
    }

    adapters = await createDurableAdapters();
    expect(adapters.pool).toBeDefined();

    const { executionService, providerRegistry } = await createOutreachExecutionService(
      adapters,
      { emit: () => {}, recordException: () => {}, startSpan: () => ({ end: () => {} }) as any } as any,
      {
        reasoningEngine: { reason: async () => ({ rationale: 'test', conclusion: '{}', confidence: 1, evidence: [] }) },
        outputValidator: { validate: async () => ({ valid: true, safeOutput: '', piiCheck: 'PASSED' }) },
      },
    );

    expect(providerRegistry.getProviderCount()).toBeGreaterThanOrEqual(1);
    expect(providerRegistry.getTenantMappingCount()).toBeGreaterThanOrEqual(1);

    const ctx: TenantContext = {
      tenantId: tempTenantId as TenantId,
      correlationId: 'test-correlation',
    };
    const provider = await providerRegistry.select(ctx, 'email');

    expect(provider).not.toBeNull();
    expect(provider?.providerId).toBe('graph-email');
    expect(provider?.channel).toBe('email');

    // The OutreachExecutionService returned by the factory must use the exact
    // same registry instance; a second/empty registry would break provider
    // resolution for any execution handled by this worker.
    const serviceRegistry = (executionService as any).deps.providerRegistry;
    expect(serviceRegistry).toBe(providerRegistry);

    const serviceProvider = await serviceRegistry.select(ctx, 'email');
    expect(serviceProvider?.providerId).toBe('graph-email');
  });
});
