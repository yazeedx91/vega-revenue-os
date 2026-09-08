/**
 * Slice 8B1c — Account live PostgreSQL persistence / isolation / concurrency proof.
 *
 * Proves the real production chain:
 *   Account aggregate → PostgresAccountRepository → PostgresClient.withTenant
 *   → projectx_app → RLS/FORCE → intelligence.accounts → reconstitution
 *
 * Self-contained fixtures: does not depend on 8B1a test data.
 * Cleans only 8B1c-owned records in FK-safe order.
 */
import { Pool } from 'pg';
import { Account } from '@projectx/domain';
import { asAccountId, asTenantId, asCorrelationId, asEventId, asEvidenceId } from '@projectx/shared';
import { PostgresClient, ConcurrencyConflictError, DuplicateRecordError } from '@projectx/infrastructure';
import type { AccountRepositoryContext } from '@projectx/infrastructure';
import { PostgresAccountRepository } from '@projectx/intelligence';
import {
  DEFAULT_ADMIN_DATABASE_URL,
  DEFAULT_APP_DATABASE_URL,
} from './integration-config';

// ---------------------------------------------------------------------------
// Connection helpers
// ---------------------------------------------------------------------------
function parsePgUrl(url: string) {
  const parsed = new URL(url);
  return {
    host: '127.0.0.1',
    port: Number(parsed.port || 5432),
    user: decodeURIComponent(parsed.username || 'projectx'),
    password: decodeURIComponent(parsed.password || 'projectx'),
    database: (parsed.pathname || '/projectx').slice(1) || 'projectx',
    connectionTimeoutMillis: 5000,
  };
}

function getAdminUrl(): string {
  return process.env.ADMIN_DATABASE_URL ?? DEFAULT_ADMIN_DATABASE_URL;
}
function getAppUrl(): string {
  return process.env.APP_DATABASE_URL ?? DEFAULT_APP_DATABASE_URL;
}

// ---------------------------------------------------------------------------
// Fixture constants — 8B1c-specific, no collision with 8B1a
// ---------------------------------------------------------------------------
const TENANT_A = 'tenant-8b1c-a';
const TENANT_B = 'tenant-8b1c-b';
const USER_A_ID = 'c1000000-0000-0000-0000-00000000a001';
const USER_B_ID = 'c1000000-0000-0000-0000-00000000b001';
const WS_A1 = 'c2000000-0000-0000-0000-00000000a001';
const WS_A2 = 'c2000000-0000-0000-0000-00000000a002';
const WS_B1 = 'c2000000-0000-0000-0000-00000000b001';

const FIXED_DATE = new Date('2025-06-15T10:00:00.000Z');

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------
function ctx(tenantId: string, workspaceId: string): AccountRepositoryContext {
  return {
    tenantId: asTenantId(tenantId),
    correlationId: asCorrelationId('corr-8b1c'),
    workspaceId,
  };
}

function makeAccount(
  tenantId: string,
  workspaceId: string,
  id: string,
  overrides: Partial<{
    domain: string;
    normalizedDomain: string;
    status: string;
    annualRevenueUsd: number;
    companySizeBand: string;
    industry: string;
    geography: string;
    employeeCount: number;
  }> = {},
): Account {
  return Account.create(
    {
      id: asAccountId(id),
      tenantId: asTenantId(tenantId),
      workspaceId,
      name: `Account ${id}`,
      domain: overrides.domain ?? 'test.example.com',
      normalizedDomain: overrides.normalizedDomain,
      aliases: ['Alias-A', 'Alias-B'],
      industry: overrides.industry ?? 'Technology',
      geography: overrides.geography ?? 'US',
      companySizeBand: (overrides.companySizeBand as any) ?? 'SMB',
      employeeCount: overrides.employeeCount ?? 250,
      annualRevenueUsd: overrides.annualRevenueUsd ?? 5000000,
      territories: ['US', 'EU'],
      techStack: ['TypeScript', 'PostgreSQL'],
      enrichmentState: 'NONE',
      status: (overrides.status as any) ?? 'DISCOVERED',
      evidenceReferences: [asEvidenceId('ev-8b1c-1'), asEvidenceId('ev-8b1c-2')],
      accountVersion: 1,
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    },
    asCorrelationId('corr-8b1c'),
    asEventId('evt-8b1c-create'),
  );
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------
let adminPool: Pool;
let appPool: Pool;
let repo: PostgresAccountRepository;

beforeAll(async () => {
  adminPool = new Pool(parsePgUrl(getAdminUrl()));
  appPool = new Pool(parsePgUrl(getAppUrl()));
  await adminPool.query('SELECT 1');
  await appPool.query('SELECT 1');

  repo = new PostgresAccountRepository(appPool);

  // Idempotent fixture creation via admin (bypasses RLS)
  await adminPool.query(`
    INSERT INTO identity.users (id, email, name, tenant_id)
    VALUES
      ('${USER_A_ID}', 'owner-8b1c-a@test.dev', 'Owner 8b1c-A', '${TENANT_A}'),
      ('${USER_B_ID}', 'owner-8b1c-b@test.dev', 'Owner 8b1c-B', '${TENANT_B}')
    ON CONFLICT (id) DO NOTHING;
  `);
  await adminPool.query(`
    INSERT INTO identity.workspaces (id, tenant_id, name, owner_user_id)
    VALUES
      ('${WS_A1}', '${TENANT_A}', 'WS-8b1c-A1', '${USER_A_ID}'),
      ('${WS_A2}', '${TENANT_A}', 'WS-8b1c-A2', '${USER_A_ID}'),
      ('${WS_B1}', '${TENANT_B}', 'WS-8b1c-B1', '${USER_B_ID}')
    ON CONFLICT (id) DO NOTHING;
  `);
});

afterAll(async () => {
  // FK-safe cleanup order: accounts → workspaces → users
  await adminPool.query(`DELETE FROM intelligence.accounts WHERE account_id LIKE 'acc-8b1c-%'`);
  await adminPool.query(`DELETE FROM identity.workspaces WHERE id IN ('${WS_A1}', '${WS_A2}', '${WS_B1}')`);
  await adminPool.query(`DELETE FROM identity.users WHERE id IN ('${USER_A_ID}', '${USER_B_ID}')`);
  await adminPool.end();
  await appPool.end();
});

// Cleanup helper for tests that create accounts
async function cleanAccounts(...ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
  await adminPool.query(`DELETE FROM intelligence.accounts WHERE account_id IN (${placeholders})`, ids);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Slice 8B1c — Account live persistence', () => {

  // 1. Real insert + round trip
  it('round-trips all frozen Account fields through real PostgreSQL', async () => {
    const account = makeAccount(TENANT_A, WS_A1, 'acc-8b1c-rt');
    const c = ctx(TENANT_A, WS_A1);

    try {
      await repo.save(c, account);
      const loaded = await repo.findById(c, 'acc-8b1c-rt');

      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(account.id);
      expect(loaded!.tenantId).toBe(account.tenantId);
      expect(loaded!.workspaceId).toBe(account.workspaceId);
      expect(loaded!.name).toBe(account.name);
      expect(loaded!.domain).toBe(account.domain);
      expect(loaded!.normalizedDomain).toBe(account.normalizedDomain);
      expect(loaded!.aliases).toEqual(account.aliases);
      expect(loaded!.industry).toBe(account.industry);
      expect(loaded!.geography).toBe(account.geography);
      expect(loaded!.companySizeBand).toBe(account.companySizeBand);
      expect(loaded!.employeeCount).toBe(account.employeeCount);
      expect(loaded!.annualRevenueUsd).toBe(account.annualRevenueUsd);
      expect(loaded!.territories).toEqual(account.territories);
      expect(loaded!.techStack).toEqual(account.techStack);
      expect(loaded!.enrichmentState).toBe(account.enrichmentState);
      expect(loaded!.status).toBe(account.status);
      expect(loaded!.duplicateOf).toBe(account.duplicateOf);
      expect(loaded!.evidenceReferences).toEqual(account.evidenceReferences);
      expect(loaded!.accountVersion).toBe(account.accountVersion);

      // Zero domain events after hydration
      expect(loaded!.domainEvents).toHaveLength(0);
    } finally {
      await cleanAccounts('acc-8b1c-rt');
    }
  });

  // 2. NUMERIC behavior
  it('pg NUMERIC round-trips as number; NULL maps to undefined', async () => {
    const withRevenue = makeAccount(TENANT_A, WS_A1, 'acc-8b1c-num1', {
      annualRevenueUsd: 1250000.50,
      domain: 'num1.example.com',
      normalizedDomain: 'num1.example.com',
    });
    const withoutRevenue = makeAccount(TENANT_A, WS_A1, 'acc-8b1c-num2', {
      annualRevenueUsd: undefined as any,
      domain: 'num2.example.com',
      normalizedDomain: 'num2.example.com',
    });
    // Force annualRevenueUsd to undefined for the null case
    (withoutRevenue as any).annualRevenueUsd = undefined;

    const c = ctx(TENANT_A, WS_A1);
    try {
      await repo.save(c, withRevenue);
      await repo.save(c, withoutRevenue);

      const loaded1 = await repo.findById(c, 'acc-8b1c-num1');
      expect(loaded1!.annualRevenueUsd).toBe(1250000.5);
      expect(typeof loaded1!.annualRevenueUsd).toBe('number');

      const loaded2 = await repo.findById(c, 'acc-8b1c-num2');
      expect(loaded2!.annualRevenueUsd).toBeUndefined();
    } finally {
      await cleanAccounts('acc-8b1c-num1', 'acc-8b1c-num2');
    }
  });

  // 3. Workspace-private reads
  it('same tenant / different workspace returns null', async () => {
    const account = makeAccount(TENANT_A, WS_A1, 'acc-8b1c-wsp', {
      domain: 'wsp.example.com',
      normalizedDomain: 'wsp.example.com',
    });
    const ctxA1 = ctx(TENANT_A, WS_A1);
    const ctxA2 = ctx(TENANT_A, WS_A2);

    try {
      await repo.save(ctxA1, account);

      const found = await repo.findById(ctxA1, 'acc-8b1c-wsp');
      expect(found).not.toBeNull();

      const notFound = await repo.findById(ctxA2, 'acc-8b1c-wsp');
      expect(notFound).toBeNull();
    } finally {
      await cleanAccounts('acc-8b1c-wsp');
    }
  });

  // 4a. Tenant isolation via repository
  it('cross-tenant repository lookup returns null', async () => {
    const account = makeAccount(TENANT_A, WS_A1, 'acc-8b1c-rls1', {
      domain: 'rls1.example.com',
      normalizedDomain: 'rls1.example.com',
    });
    const ctxA = ctx(TENANT_A, WS_A1);
    // Tenant B has its own workspace, but we try to look up tenant A's account
    const ctxB = ctx(TENANT_B, WS_B1);

    try {
      await repo.save(ctxA, account);

      const notFound = await repo.findById(ctxB, 'acc-8b1c-rls1');
      expect(notFound).toBeNull();
    } finally {
      await cleanAccounts('acc-8b1c-rls1');
    }
  });

  // 4b. RLS-only probe: proves PostgreSQL RLS blocks, not just repository predicates
  it('RLS independently blocks cross-tenant visibility via appPool', async () => {
    const account = makeAccount(TENANT_A, WS_A1, 'acc-8b1c-rls2', {
      domain: 'rls2.example.com',
      normalizedDomain: 'rls2.example.com',
    });
    const ctxA = ctx(TENANT_A, WS_A1);

    try {
      await repo.save(ctxA, account);

      // Use real PostgresClient.withTenant to set tenant B context,
      // then issue a query WITHOUT tenant_id predicate — only RLS can block.
      const pgClient = new PostgresClient(appPool);
      const result = await pgClient.withTenant(ctx(TENANT_B, WS_B1), async (client) => {
        return client.query(
          `SELECT account_id FROM intelligence.accounts WHERE account_id = $1`,
          ['acc-8b1c-rls2'],
        );
      });
      expect(result.rows).toHaveLength(0);
    } finally {
      await cleanAccounts('acc-8b1c-rls2');
    }
  });

  // 5. Same domain across workspaces
  it('same normalized_domain allowed in different workspaces', async () => {
    const a1 = makeAccount(TENANT_A, WS_A1, 'acc-8b1c-xws1', {
      domain: 'cross-ws-8b1c.com',
      normalizedDomain: 'cross-ws-8b1c.com',
    });
    const a2 = makeAccount(TENANT_A, WS_A2, 'acc-8b1c-xws2', {
      domain: 'cross-ws-8b1c.com',
      normalizedDomain: 'cross-ws-8b1c.com',
    });

    try {
      await repo.save(ctx(TENANT_A, WS_A1), a1);
      await repo.save(ctx(TENANT_A, WS_A2), a2);

      const loaded1 = await repo.findById(ctx(TENANT_A, WS_A1), 'acc-8b1c-xws1');
      const loaded2 = await repo.findById(ctx(TENANT_A, WS_A2), 'acc-8b1c-xws2');
      expect(loaded1).not.toBeNull();
      expect(loaded2).not.toBeNull();
      expect(loaded1!.normalizedDomain).toBe('cross-ws-8b1c.com');
      expect(loaded2!.normalizedDomain).toBe('cross-ws-8b1c.com');
    } finally {
      await cleanAccounts('acc-8b1c-xws1', 'acc-8b1c-xws2');
    }
  });

  // 6. Duplicate domain same workspace → DuplicateRecordError
  it('duplicate normalized_domain in same workspace → DuplicateRecordError', async () => {
    const a1 = makeAccount(TENANT_A, WS_A1, 'acc-8b1c-dup1', {
      domain: 'dedup-8b1c.com',
      normalizedDomain: 'dedup-8b1c.com',
    });
    const a2 = makeAccount(TENANT_A, WS_A1, 'acc-8b1c-dup2', {
      domain: 'dedup-8b1c.com',
      normalizedDomain: 'dedup-8b1c.com',
    });

    try {
      await repo.save(ctx(TENANT_A, WS_A1), a1);

      const err = await repo.save(ctx(TENANT_A, WS_A1), a2).catch((e) => e);
      expect(err).toBeInstanceOf(DuplicateRecordError);
      expect(err.conflictField).toBe('normalized_domain');
    } finally {
      await cleanAccounts('acc-8b1c-dup1', 'acc-8b1c-dup2');
    }
  });

  // 7. NULL-domain partial uniqueness
  it('multiple NULL normalized_domain accounts in same workspace succeed', async () => {
    const a1 = makeAccount(TENANT_A, WS_A1, 'acc-8b1c-nul1', {
      domain: undefined as any,
      normalizedDomain: undefined as any,
    });
    (a1 as any).domain = undefined;
    (a1 as any).normalizedDomain = undefined;

    const a2 = makeAccount(TENANT_A, WS_A1, 'acc-8b1c-nul2', {
      domain: undefined as any,
      normalizedDomain: undefined as any,
    });
    (a2 as any).domain = undefined;
    (a2 as any).normalizedDomain = undefined;

    try {
      await repo.save(ctx(TENANT_A, WS_A1), a1);
      await repo.save(ctx(TENANT_A, WS_A1), a2);

      const loaded1 = await repo.findById(ctx(TENANT_A, WS_A1), 'acc-8b1c-nul1');
      const loaded2 = await repo.findById(ctx(TENANT_A, WS_A1), 'acc-8b1c-nul2');
      expect(loaded1).not.toBeNull();
      expect(loaded2).not.toBeNull();
      expect(loaded1!.normalizedDomain).toBeUndefined();
      expect(loaded2!.normalizedDomain).toBeUndefined();
    } finally {
      await cleanAccounts('acc-8b1c-nul1', 'acc-8b1c-nul2');
    }
  });

  // 8. Composite tenant/workspace FK
  it('composite FK rejects tenant/workspace ownership mismatch via admin path', async () => {
    // WS_B1 belongs to TENANT_B. Inserting account as TENANT_A + WS_B1 must fail at FK level.
    // Use admin pool to bypass RLS and isolate the FK constraint.
    await expect(
      adminPool.query(
        `INSERT INTO intelligence.accounts (account_id, tenant_id, workspace_id, name)
         VALUES ('acc-8b1c-fk-bad', $1, $2, 'FK Mismatch')`,
        [TENANT_A, WS_B1],
      ),
    ).rejects.toThrow(/accounts_tenant_workspace_fk|violates foreign key/i);
  });

  // 9. Real optimistic concurrency control
  it('stale version fails, persisted state is winners, version correct', async () => {
    const account = makeAccount(TENANT_A, WS_A1, 'acc-8b1c-occ', {
      domain: 'occ-8b1c.com',
      normalizedDomain: 'occ-8b1c.com',
    });
    const c = ctx(TENANT_A, WS_A1);

    try {
      // Save version 1
      await repo.save(c, account);

      // Load two copies
      const copyA = await repo.findById(c, 'acc-8b1c-occ');
      const copyB = await repo.findById(c, 'acc-8b1c-occ');
      expect(copyA!.loadedVersion).toBe(1);
      expect(copyB!.loadedVersion).toBe(1);

      // Mutate A (version → 2) via domain transition
      copyA!.enrich(
        { industry: 'Winner Industry' },
        [],
        asCorrelationId('corr-a'),
        asEventId('evt-a'),
      );
      expect(copyA!.accountVersion).toBe(2);

      // Save A → succeeds
      await repo.save(c, copyA!);

      // Mutate B (version → 2) via domain transition
      copyB!.enrich(
        { industry: 'Loser Industry' },
        [],
        asCorrelationId('corr-b'),
        asEventId('evt-b'),
      );
      expect(copyB!.accountVersion).toBe(2);

      // Save B → stale, must fail
      await expect(repo.save(c, copyB!)).rejects.toThrow(ConcurrencyConflictError);

      // Reload and verify durable state
      const reloaded = await repo.findById(c, 'acc-8b1c-occ');
      expect(reloaded!.accountVersion).toBe(2);
      expect(reloaded!.loadedVersion).toBe(2);
      expect(reloaded!.industry).toBe('Winner Industry');
      // Loser mutation is absent
      expect(reloaded!.industry).not.toBe('Loser Industry');
    } finally {
      await cleanAccounts('acc-8b1c-occ');
    }
  });

  // 10. findQualified workspace boundary
  it('findQualified returns only current workspace accounts', async () => {
    // Create qualified accounts in both workspaces using domain transitions
    const a1 = makeAccount(TENANT_A, WS_A1, 'acc-8b1c-fq1', {
      domain: 'fq1-8b1c.com',
      normalizedDomain: 'fq1-8b1c.com',
    });
    const a2 = makeAccount(TENANT_A, WS_A2, 'acc-8b1c-fq2', {
      domain: 'fq2-8b1c.com',
      normalizedDomain: 'fq2-8b1c.com',
    });

    const ctxA1 = ctx(TENANT_A, WS_A1);
    const ctxA2 = ctx(TENANT_A, WS_A2);

    try {
      await repo.save(ctxA1, a1);
      await repo.save(ctxA2, a2);

      // Reload to get loadedVersion set, then qualify via domain transition
      const loaded1 = await repo.findById(ctxA1, 'acc-8b1c-fq1');
      loaded1!.qualify(asCorrelationId('c'), asEventId('e'));
      await repo.save(ctxA1, loaded1!);

      const loaded2 = await repo.findById(ctxA2, 'acc-8b1c-fq2');
      loaded2!.qualify(asCorrelationId('c'), asEventId('e'));
      await repo.save(ctxA2, loaded2!);

      // findQualified for WS_A1 must return only a1
      const qualifiedA1 = await repo.findQualified(ctxA1);
      const ids1 = qualifiedA1.map((a) => a.id);
      expect(ids1).toContain('acc-8b1c-fq1');
      expect(ids1).not.toContain('acc-8b1c-fq2');

      // findQualified for WS_A2 must return only a2
      const qualifiedA2 = await repo.findQualified(ctxA2);
      const ids2 = qualifiedA2.map((a) => a.id);
      expect(ids2).toContain('acc-8b1c-fq2');
      expect(ids2).not.toContain('acc-8b1c-fq1');
    } finally {
      await cleanAccounts('acc-8b1c-fq1', 'acc-8b1c-fq2');
    }
  });

  // 11. App-role safety
  it('projectx_app has no superuser/bypassrls; FORCE RLS enabled', async () => {
    const roleResult = await adminPool.query(`
      SELECT rolsuper, rolbypassrls
      FROM pg_roles
      WHERE rolname = 'projectx_app';
    `);
    expect(roleResult.rows).toHaveLength(1);
    expect(roleResult.rows[0].rolsuper).toBe(false);
    expect(roleResult.rows[0].rolbypassrls).toBe(false);

    const rlsResult = await adminPool.query(`
      SELECT relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE oid = 'intelligence.accounts'::regclass;
    `);
    expect(rlsResult.rows[0].relrowsecurity).toBe(true);
    expect(rlsResult.rows[0].relforcerowsecurity).toBe(true);
  });
});
