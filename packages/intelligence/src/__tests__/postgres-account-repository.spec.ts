import { Account, TenantIsolationError, AuthorizationError } from '@projectx/domain';
import { asTenantId, asAccountId, asCorrelationId, asEventId } from '@projectx/shared';
import { ConcurrencyConflictError, DuplicateRecordError } from '@projectx/infrastructure';
import type { AccountRepositoryContext } from '@projectx/infrastructure';
import { PostgresAccountRepository } from '../infrastructure/postgres-account-repository';

// ---------------------------------------------------------------------------
// Lightweight fake pg pool/client that intercepts Account-specific SQL,
// records queries + params, and returns predictable rows. No live PostgreSQL.
// ---------------------------------------------------------------------------

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

interface FakeRow {
  [key: string]: unknown;
}

class FakePoolClient {
  readonly queries: RecordedQuery[] = [];
  private rows: FakeRow[][] = [];
  private errors: (Error | null)[] = [];

  /** Queue a result for the next non-set_config query. */
  queueResult(rows: FakeRow[], error: Error | null = null): void {
    this.rows.push(rows);
    this.errors.push(error);
  }

  async query(sql: string, params?: unknown[]): Promise<{ rows: FakeRow[]; rowCount: number }> {
    this.queries.push({ sql, params: params ?? [] });
    // set_config calls are passthrough
    if (sql.includes('set_config')) {
      return { rows: [], rowCount: 0 };
    }
    const err = this.errors.shift();
    if (err) throw err;
    const rows = this.rows.shift() ?? [];
    return { rows, rowCount: rows.length };
  }

  release(): void {}
}

class FakePool {
  readonly client = new FakePoolClient();

  async connect(): Promise<FakePoolClient> {
    return this.client;
  }

  async query(sql: string, params?: unknown[]): Promise<{ rows: FakeRow[]; rowCount: number }> {
    return this.client.query(sql, params);
  }

  async end(): Promise<void> {}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(tenantId = 'tenant-1', workspaceId = 'ws-1'): AccountRepositoryContext {
  return {
    tenantId: asTenantId(tenantId),
    correlationId: asCorrelationId('corr-test'),
    workspaceId,
  };
}

const FIXED_DATE = new Date('2025-01-15T12:00:00.000Z');

function makeAccount(
  tenantId = 'tenant-1',
  workspaceId = 'ws-1',
  id = 'acc-1',
  overrides: Partial<{
    domain: string;
    normalizedDomain: string;
    status: string;
    accountVersion: number;
    annualRevenueUsd: number;
  }> = {},
): Account {
  return Account.create(
    {
      id: asAccountId(id),
      tenantId: asTenantId(tenantId),
      workspaceId,
      name: `Account ${id}`,
      domain: overrides.domain ?? 'acme.example.com',
      normalizedDomain: overrides.normalizedDomain,
      industry: 'Technology',
      geography: 'US',
      companySizeBand: 'SMB',
      employeeCount: 100,
      annualRevenueUsd: overrides.annualRevenueUsd ?? 5000000,
      territories: ['US', 'EU'],
      techStack: ['TypeScript', 'PostgreSQL'],
      enrichmentState: 'NONE',
      status: (overrides.status as any) ?? 'DISCOVERED',
      aliases: ['Acme Corp'],
      evidenceReferences: [],
      accountVersion: overrides.accountVersion ?? 1,
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    },
    asCorrelationId('corr-1'),
    asEventId('evt-1'),
  );
}

/** Build a fake DB row that mimics what pg would return. */
function makeRow(account: Account, overrides: Record<string, unknown> = {}): FakeRow {
  return {
    account_id: account.id,
    tenant_id: account.tenantId,
    workspace_id: account.workspaceId,
    name: account.name,
    domain: account.domain ?? null,
    normalized_domain: account.normalizedDomain ?? null,
    aliases: account.aliases,
    industry: account.industry ?? null,
    geography: account.geography ?? null,
    company_size_band: account.companySizeBand ?? null,
    employee_count: account.employeeCount ?? null,
    annual_revenue_usd: account.annualRevenueUsd ?? null,
    territories: account.territories,
    tech_stack: account.techStack,
    enrichment_state: account.enrichmentState,
    status: account.status,
    duplicate_of: account.duplicateOf ?? null,
    evidence_references: account.evidenceReferences,
    account_version: account.accountVersion,
    created_at: account.createdAt,
    updated_at: account.updatedAt,
    ...overrides,
  };
}

function getNonConfigQueries(client: FakePoolClient): RecordedQuery[] {
  return client.queries.filter((q) => !q.sql.includes('set_config'));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PostgresAccountRepository', () => {
  let pool: FakePool;
  let repo: PostgresAccountRepository;

  beforeEach(() => {
    pool = new FakePool();
    repo = new PostgresAccountRepository(pool as any);
  });

  // -- INSERT PARAMETER MAPPING -------------------------------------------

  it('insert maps all Account fields as parameterized values', async () => {
    const ctx = makeCtx();
    const account = makeAccount();
    pool.client.queueResult([{ rowCount: 1 } as any]); // INSERT result

    await repo.save(ctx, account);

    const queries = getNonConfigQueries(pool.client);
    expect(queries).toHaveLength(1);
    const q = queries[0];
    expect(q.sql).toContain('INSERT INTO intelligence.accounts');
    expect(q.params).toHaveLength(21);

    // Verify key positional params
    expect(q.params[0]).toBe(account.id);              // account_id
    expect(q.params[1]).toBe('tenant-1');              // tenant_id
    expect(q.params[2]).toBe('ws-1');                  // workspace_id
    expect(q.params[3]).toBe(account.name);            // name
    expect(q.params[4]).toBe(account.domain);          // domain
    expect(q.params[5]).toBe(account.normalizedDomain); // normalized_domain
    expect(q.params[6]).toBe(JSON.stringify(account.aliases)); // aliases
    expect(q.params[7]).toBe(account.industry);        // industry
    expect(q.params[8]).toBe(account.geography);       // geography
    expect(q.params[9]).toBe(account.companySizeBand); // company_size_band
    expect(q.params[10]).toBe(account.employeeCount);  // employee_count
    expect(q.params[11]).toBe(account.annualRevenueUsd); // annual_revenue_usd
    expect(q.params[12]).toBe(JSON.stringify(account.territories)); // territories
    expect(q.params[13]).toBe(JSON.stringify(account.techStack)); // tech_stack
    expect(q.params[14]).toBe(account.enrichmentState); // enrichment_state
    expect(q.params[15]).toBe(account.status);         // status
    expect(q.params[16]).toBeNull();                   // duplicate_of
    expect(q.params[17]).toBe(JSON.stringify(account.evidenceReferences)); // evidence_references
    expect(q.params[18]).toBe(account.accountVersion); // account_version
    expect(q.params[19]).toEqual(account.createdAt);   // created_at
    expect(q.params[20]).toEqual(account.updatedAt);   // updated_at

    // No string interpolation of tenant/workspace in SQL text
    expect(q.sql).not.toContain('tenant-1');
    expect(q.sql).not.toContain('ws-1');
  });

  // -- READ RECONSTITUTION ------------------------------------------------

  it('read reconstitutes exact Account state with zero domain events', async () => {
    const ctx = makeCtx();
    const original = makeAccount();
    const row = makeRow(original);
    pool.client.queueResult([row]);

    const found = await repo.findById(ctx, 'acc-1');

    expect(found).not.toBeNull();
    expect(found!.id).toBe(original.id);
    expect(found!.tenantId).toBe(original.tenantId);
    expect(found!.workspaceId).toBe(original.workspaceId);
    expect(found!.name).toBe(original.name);
    expect(found!.domain).toBe(original.domain);
    expect(found!.normalizedDomain).toBe(original.normalizedDomain);
    expect(found!.aliases).toEqual(original.aliases);
    expect(found!.industry).toBe(original.industry);
    expect(found!.geography).toBe(original.geography);
    expect(found!.companySizeBand).toBe(original.companySizeBand);
    expect(found!.employeeCount).toBe(original.employeeCount);
    expect(found!.annualRevenueUsd).toBe(original.annualRevenueUsd);
    expect(found!.territories).toEqual(original.territories);
    expect(found!.techStack).toEqual(original.techStack);
    expect(found!.enrichmentState).toBe(original.enrichmentState);
    expect(found!.status).toBe(original.status);
    expect(found!.duplicateOf).toBe(original.duplicateOf);
    expect(found!.evidenceReferences).toEqual(original.evidenceReferences);
    expect(found!.accountVersion).toBe(original.accountVersion);
    expect(found!.createdAt).toEqual(original.createdAt);
    expect(found!.updatedAt).toEqual(original.updatedAt);

    // Zero domain events after hydration
    expect(found!.domainEvents).toHaveLength(0);
  });

  // -- WORKSPACE ROUND TRIP -----------------------------------------------

  it('workspaceId survives round trip via SQL params', async () => {
    const ctx = makeCtx('tenant-1', 'ws-special');
    const account = makeAccount('tenant-1', 'ws-special', 'acc-ws');
    pool.client.queueResult([]); // INSERT

    await repo.save(ctx, account);

    const q = getNonConfigQueries(pool.client)[0];
    expect(q.params[2]).toBe('ws-special');
  });

  // -- NORMALIZED DOMAIN PASSTHROUGH --------------------------------------

  it('normalizedDomain survives unchanged through reconstitution', async () => {
    const ctx = makeCtx();
    const row: FakeRow = {
      account_id: 'acc-nd',
      tenant_id: 'tenant-1',
      workspace_id: 'ws-1',
      name: 'ND Account',
      domain: 'www.example.co.uk',
      normalized_domain: 'example.co.uk',
      aliases: [],
      industry: null,
      geography: null,
      company_size_band: null,
      employee_count: null,
      annual_revenue_usd: null,
      territories: [],
      tech_stack: [],
      enrichment_state: 'NONE',
      status: 'DISCOVERED',
      duplicate_of: null,
      evidence_references: [],
      account_version: 1,
      created_at: FIXED_DATE,
      updated_at: FIXED_DATE,
    };
    pool.client.queueResult([row]);

    const found = await repo.findById(ctx, 'acc-nd');
    expect(found!.normalizedDomain).toBe('example.co.uk');
  });

  // -- NUMERIC CONVERSION -------------------------------------------------

  it('annual_revenue_usd string from pg rehydrates as number', async () => {
    const ctx = makeCtx();
    const row = makeRow(makeAccount(), { annual_revenue_usd: '1250000.50' });
    pool.client.queueResult([row]);

    const found = await repo.findById(ctx, 'acc-1');
    expect(found!.annualRevenueUsd).toBe(1250000.5);
    expect(typeof found!.annualRevenueUsd).toBe('number');
  });

  it('rejects non-finite NUMERIC values', async () => {
    const ctx = makeCtx();
    const row = makeRow(makeAccount(), { annual_revenue_usd: 'NaN' });
    pool.client.queueResult([row]);

    await expect(repo.findById(ctx, 'acc-1')).rejects.toThrow('non-finite');
  });

  // -- FIND_BY_ID TENANT+WORKSPACE PREDICATES -----------------------------

  it('findById includes tenant_id and workspace_id in SQL', async () => {
    const ctx = makeCtx('t-abc', 'ws-xyz');
    pool.client.queueResult([]);

    await repo.findById(ctx, 'acc-test');

    const q = getNonConfigQueries(pool.client)[0];
    expect(q.sql).toContain('tenant_id = $1');
    expect(q.sql).toContain('workspace_id = $2');
    expect(q.sql).toContain('account_id = $3');
    expect(q.params[0]).toBe('t-abc');
    expect(q.params[1]).toBe('ws-xyz');
    expect(q.params[2]).toBe('acc-test');
  });

  // -- FIND_QUALIFIED TENANT+WORKSPACE PREDICATES -------------------------

  it('findQualified includes tenant_id and workspace_id in SQL', async () => {
    const ctx = makeCtx('t-q', 'ws-q');
    pool.client.queueResult([]);

    await repo.findQualified(ctx);

    const q = getNonConfigQueries(pool.client)[0];
    expect(q.sql).toContain('tenant_id = $1');
    expect(q.sql).toContain('workspace_id = $2');
    expect(q.sql).toContain("status = 'QUALIFIED'");
    expect(q.params[0]).toBe('t-q');
    expect(q.params[1]).toBe('ws-q');
  });

  // -- WRITE OWNERSHIP MISMATCH ISSUES NO SQL -----------------------------

  it('save with workspace mismatch issues no SQL', async () => {
    const ctx = makeCtx('tenant-1', 'ws-wrong');
    const account = makeAccount('tenant-1', 'ws-1', 'acc-mis');

    await expect(repo.save(ctx, account)).rejects.toThrow(AuthorizationError);

    // Only set_config queries (from withTenant), no INSERT/UPDATE
    const dataQueries = getNonConfigQueries(pool.client);
    expect(dataQueries).toHaveLength(0);
  });

  it('save with tenant mismatch issues no SQL', async () => {
    const ctx = makeCtx('tenant-wrong', 'ws-1');
    const account = makeAccount('tenant-1', 'ws-1', 'acc-tmis');

    await expect(repo.save(ctx, account)).rejects.toThrow(TenantIsolationError);

    const dataQueries = getNonConfigQueries(pool.client);
    expect(dataQueries).toHaveLength(0);
  });

  // -- VERSION SEMANTICS --------------------------------------------------

  it('domain version N / loadedVersion N after reconstitution', async () => {
    const ctx = makeCtx();
    const row = makeRow(makeAccount(), { account_version: 3 });
    pool.client.queueResult([row]);

    const found = await repo.findById(ctx, 'acc-1');
    expect(found!.accountVersion).toBe(3);
    expect(found!.loadedVersion).toBe(3);
    expect(found!.version).toBe(3);
  });

  it('update uses WHERE expected=N, SET N+1 after domain mutation', async () => {
    const ctx = makeCtx();
    // Simulate a reconstituted account with version 2
    const account = Account.reconstitute(
      {
        id: asAccountId('acc-v'),
        tenantId: asTenantId('tenant-1'),
        workspaceId: 'ws-1',
        name: 'Versioned',
        accountVersion: 2,
        createdAt: FIXED_DATE,
        updatedAt: FIXED_DATE,
      },
      2,
    );
    expect(account.loadedVersion).toBe(2);
    expect(account.accountVersion).toBe(2);

    // Domain mutation increments accountVersion to 3
    account.enrich({}, [], asCorrelationId('c'), asEventId('e'));
    expect(account.accountVersion).toBe(3);
    expect(account.loadedVersion).toBe(2); // unchanged until save succeeds

    pool.client.queueResult([{ rowCount: 1 } as any]); // UPDATE succeeds (1 row)

    await repo.save(ctx, account);

    const q = getNonConfigQueries(pool.client)[0];
    expect(q.sql).toContain('UPDATE intelligence.accounts');
    // $4 = WHERE account_version (expected)
    expect(q.params[3]).toBe(2);
    // $20 = SET account_version (new)
    expect(q.params[19]).toBe(3);

    // After save, loadedVersion updated
    expect(account.loadedVersion).toBe(3);
    expect(account.accountVersion).toBe(3);
  });

  it('stale version throws ConcurrencyConflictError', async () => {
    const ctx = makeCtx();
    const account = Account.reconstitute(
      {
        id: asAccountId('acc-stale'),
        tenantId: asTenantId('tenant-1'),
        workspaceId: 'ws-1',
        name: 'Stale',
        accountVersion: 1,
        createdAt: FIXED_DATE,
        updatedAt: FIXED_DATE,
      },
      1,
    );
    account.enrich({}, [], asCorrelationId('c'), asEventId('e'));

    // UPDATE returns 0 rows (stale version)
    pool.client.queueResult([]);

    await expect(repo.save(ctx, account)).rejects.toThrow(ConcurrencyConflictError);
  });

  it('repository never increments version itself', async () => {
    const ctx = makeCtx();
    const account = makeAccount();
    expect(account.accountVersion).toBe(1);

    pool.client.queueResult([]); // INSERT

    await repo.save(ctx, account);

    const q = getNonConfigQueries(pool.client)[0];
    // account_version param must equal exactly what the aggregate has
    expect(q.params[18]).toBe(1); // INSERT $19 = account_version
    expect(account.accountVersion).toBe(1); // repo did not change it
  });

  it('successful save sets loadedVersion to accountVersion', async () => {
    const ctx = makeCtx();
    const account = makeAccount();
    expect(account.loadedVersion).toBeUndefined(); // new aggregate

    pool.client.queueResult([]); // INSERT

    await repo.save(ctx, account);

    expect(account.loadedVersion).toBe(account.accountVersion);
    expect(account.loadedVersion).toBe(1);
  });

  // -- ERROR CLASSIFICATION -----------------------------------------------

  it('PK conflict on INSERT → ConcurrencyConflictError', async () => {
    const ctx = makeCtx();
    const account = makeAccount();

    const pgErr = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'accounts_pkey',
    });
    pool.client.queueResult([], pgErr);

    await expect(repo.save(ctx, account)).rejects.toThrow(ConcurrencyConflictError);
  });

  it('duplicate normalized_domain → DuplicateRecordError', async () => {
    const ctx = makeCtx();
    const account = makeAccount();

    const pgErr = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'accounts_workspace_domain_dedup',
    });
    pool.client.queueResult([], pgErr);

    const err = await repo.save(ctx, account).catch((e) => e);
    expect(err).toBeInstanceOf(DuplicateRecordError);
    expect(err.conflictField).toBe('normalized_domain');
    expect(err.message).not.toContain('23505'); // no raw PG code
  });

  it('other PG errors produce sanitized persistence error', async () => {
    const ctx = makeCtx();
    const account = makeAccount();

    const pgErr = Object.assign(new Error('FK violation detail: secret SQL'), {
      code: '23503',
      constraint: 'accounts_workspace_id_fkey',
    });
    pool.client.queueResult([], pgErr);

    const err = await repo.save(ctx, account).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ConcurrencyConflictError);
    expect(err).not.toBeInstanceOf(DuplicateRecordError);
    expect(err.message).toContain('Persistence failure');
    expect(err.message).not.toContain('secret SQL');
  });

  // -- SQL PARAMETERIZATION -----------------------------------------------

  it('SQL uses $N parameters, not interpolated values', async () => {
    const ctx = makeCtx('my-tenant', 'my-workspace');
    const account = makeAccount('my-tenant', 'my-workspace', 'my-account');
    pool.client.queueResult([]);

    await repo.save(ctx, account);

    const q = getNonConfigQueries(pool.client)[0];
    // SQL text must not contain actual tenant/workspace/account values
    expect(q.sql).not.toContain('my-tenant');
    expect(q.sql).not.toContain('my-workspace');
    expect(q.sql).not.toContain('my-account');
    // Must use $N placeholders
    expect(q.sql).toMatch(/\$\d+/);
  });
});
