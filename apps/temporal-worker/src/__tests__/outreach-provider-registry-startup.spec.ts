import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import type { TenantContext } from '@projectx/domain';
import type { TenantId } from '@projectx/shared';
import { createDurableAdapters, createOutreachExecutionService } from '../outreach-execution-service.factory';

describe('Outreach provider registry startup (integration)', () => {
  // Integration tests seed and read cross-tenant configuration, which requires the
  // admin/owner connection. The runtime factory reads DATABASE_URL internally.
  const databaseUrl = 'postgresql://projectx:projectx@localhost:5433/projectx';

  let pool: Pool | undefined;
  let tempTenantId: string | undefined;

  beforeEach(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.OUTREACH_LIVE_EMAIL_ENABLED = 'false';
    process.env.OUTREACH_MODE = 'ALLOWLIST_ONLY';
    process.env.GRAPH_TENANT_ID = 'test-tenant';
    process.env.GRAPH_CLIENT_ID = 'test-client';
    process.env.GRAPH_CLIENT_SECRET = 'test-secret';
    process.env.GRAPH_SENDER_ADDRESS = 'sender@example.com';

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
  });

  it('loads tenant email config from Postgres into the same registry used by execution', async () => {
    const adapters = createDurableAdapters();
    expect(adapters.pool).toBeDefined();

    const { executionService, providerRegistry } = await createOutreachExecutionService(
      adapters,
      { emit: () => {}, recordException: () => {}, startSpan: () => ({ end: () => {} }) as any } as any,
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
