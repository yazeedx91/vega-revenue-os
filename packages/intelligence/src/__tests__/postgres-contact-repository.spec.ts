import { Contact, TenantIsolationError, AuthorizationError } from '@projectx/domain';
import { asTenantId, asAccountId, asContactId, asCorrelationId, asEventId, asEvidenceId } from '@projectx/shared';
import { ConcurrencyConflictError, DuplicateRecordError } from '@projectx/infrastructure';
import type { ContactRepositoryContext } from '@projectx/infrastructure';
import { PostgresContactRepository } from '../infrastructure/postgres-contact-repository';

// ---------------------------------------------------------------------------
// Lightweight fake pg pool/client that intercepts Contact-specific SQL,
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

function makeCtx(tenantId = 'tenant-1', workspaceId = 'ws-1'): ContactRepositoryContext {
  return {
    tenantId: asTenantId(tenantId),
    correlationId: asCorrelationId('corr-test'),
    workspaceId,
  };
}

const FIXED_DATE = new Date('2025-01-15T12:00:00.000Z');

function baseContactProps(overrides: Record<string, unknown> = {}) {
  return {
    id: asContactId('con-1'),
    tenantId: asTenantId('tenant-1'),
    workspaceId: 'ws-1',
    accountId: asAccountId('acc-1'),
    name: 'Jane Doe',
    title: null,
    role: null,
    seniority: null,
    department: null,
    functionRole: null,
    emailFingerprint: null,
    encryptedEmail: null,
    phoneFingerprint: null,
    encryptedPhone: null,
    linkedInUrl: null,
    channels: [],
    consentStatus: null,
    verificationState: 'UNVERIFIED' as const,
    status: 'DISCOVERED' as const,
    suppressionReason: null,
    suppressionReference: null,
    suppressedAt: null,
    evidenceReferences: [],
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  };
}

/** Build a fake DB row that mimics what pg would return. */
function makeRow(contact: Contact, overrides: Record<string, unknown> = {}): FakeRow {
  return {
    contact_id: contact.id,
    tenant_id: contact.tenantId,
    workspace_id: contact.workspaceId,
    account_id: contact.accountId,
    name: contact.name ?? null,
    title: contact.title ?? null,
    role: contact.role ?? null,
    seniority: contact.seniority ?? null,
    department: contact.department ?? null,
    function_role: contact.functionRole ?? null,
    email_fingerprint: contact.emailFingerprint ?? null,
    encrypted_email: contact.encryptedEmail ?? null,
    phone_fingerprint: contact.phoneFingerprint ?? null,
    encrypted_phone: contact.encryptedPhone ?? null,
    linked_in_url: contact.linkedInUrl ?? null,
    channels: contact.channels,
    consent_status: contact.consentStatus ?? null,
    verification_state: contact.verificationState,
    status: contact.status,
    suppression_reason: contact.suppressionReason ?? null,
    suppression_reference: contact.suppressionReference ?? null,
    suppressed_at: contact.suppressedAt ?? null,
    evidence_references: contact.evidenceReferences,
    contact_version: contact.version,
    created_at: contact.createdAt,
    updated_at: contact.updatedAt,
    ...overrides,
  };
}

function getNonConfigQueries(client: FakePoolClient): RecordedQuery[] {
  return client.queries.filter((q) => !q.sql.includes('set_config'));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PostgresContactRepository', () => {
  let pool: FakePool;
  let repo: PostgresContactRepository;

  beforeEach(() => {
    pool = new FakePool();
    repo = new PostgresContactRepository(pool as any);
  });

  // -- INSERT PARAMETER MAPPING -------------------------------------------

  it('INSERT maps all persisted Contact fields from migrations 027 + 028', async () => {
    const ctx = makeCtx();
    const contact = Contact.discover(
      baseContactProps({
        emailFingerprint: 'h1_a1b2c3d4',
        encryptedEmail: 'e1_a1b2c3d4',
        phoneFingerprint: 'h1_e5f6g7h8',
        encryptedPhone: 'e1_e5f6g7h8',
      }),
      'test-source',
      asCorrelationId('corr-1'),
      asEventId('evt-1'),
    );
    pool.client.queueResult([]); // INSERT result

    await repo.save(ctx, contact);

    const queries = getNonConfigQueries(pool.client);
    expect(queries).toHaveLength(1);
    const q = queries[0];
    expect(q.sql).toContain('INSERT INTO intelligence.contacts');
    expect(q.params).toHaveLength(26);

    // Verify key positional params
    expect(q.params[0]).toBe(contact.id);              // $1  contact_id
    expect(q.params[1]).toBe('tenant-1');              // $2  tenant_id
    expect(q.params[2]).toBe('ws-1');                  // $3  workspace_id
    expect(q.params[3]).toBe(contact.accountId);      // $4  account_id
    expect(q.params[4]).toBe(contact.name);            // $5  name
    expect(q.params[10]).toBe('h1_a1b2c3d4');          // $11 email_fingerprint
    expect(q.params[11]).toBe('e1_a1b2c3d4');          // $12 encrypted_email
    expect(q.params[12]).toBe('h1_e5f6g7h8');          // $13 phone_fingerprint
    expect(q.params[13]).toBe('e1_e5f6g7h8');          // $14 encrypted_phone
    expect(q.params[15]).toBe(JSON.stringify(contact.channels)); // $16 channels
    expect(q.params[22]).toBe(JSON.stringify(contact.evidenceReferences)); // $23 evidence_references
    expect(q.params[23]).toBe(contact.version);        // $24 contact_version
    expect(q.params[24]).toEqual(contact.createdAt);   // $25 created_at
    expect(q.params[25]).toEqual(contact.updatedAt);   // $26 updated_at

    // No string interpolation of tenant/workspace in SQL text
    expect(q.sql).not.toContain('tenant-1');
    expect(q.sql).not.toContain('ws-1');
  });

  // -- PROTECTED CHANNEL PASSTHROUGH --------------------------------------

  it('protected email fingerprint passes through unchanged', async () => {
    const ctx = makeCtx();
    const contact = Contact.discover(
      baseContactProps({ emailFingerprint: 'h1_abc123' }),
      'test-source',
      asCorrelationId('c'),
      asEventId('e'),
    );
    pool.client.queueResult([]);

    await repo.save(ctx, contact);

    const q = getNonConfigQueries(pool.client)[0];
    expect(q.params[10]).toBe('h1_abc123');
  });

  it('encrypted email passes through unchanged', async () => {
    const ctx = makeCtx();
    const contact = Contact.discover(
      baseContactProps({ encryptedEmail: 'e1_xyz789' }),
      'test-source',
      asCorrelationId('c'),
      asEventId('e'),
    );
    pool.client.queueResult([]);

    await repo.save(ctx, contact);

    const q = getNonConfigQueries(pool.client)[0];
    expect(q.params[11]).toBe('e1_xyz789');
  });

  it('protected phone fingerprint passes through unchanged', async () => {
    const ctx = makeCtx();
    const contact = Contact.discover(
      baseContactProps({ phoneFingerprint: 'h1_phone123' }),
      'test-source',
      asCorrelationId('c'),
      asEventId('e'),
    );
    pool.client.queueResult([]);

    await repo.save(ctx, contact);

    const q = getNonConfigQueries(pool.client)[0];
    expect(q.params[12]).toBe('h1_phone123');
  });

  it('encrypted phone passes through unchanged', async () => {
    const ctx = makeCtx();
    const contact = Contact.discover(
      baseContactProps({ encryptedPhone: 'e1_phone789' }),
      'test-source',
      asCorrelationId('c'),
      asEventId('e'),
    );
    pool.client.queueResult([]);

    await repo.save(ctx, contact);

    const q = getNonConfigQueries(pool.client)[0];
    expect(q.params[13]).toBe('e1_phone789');
  });

  // -- NO PLAINTEXT PERSISTENCE -------------------------------------------

  it('INSERT SQL does not contain plaintext email or phone columns', async () => {
    const ctx = makeCtx();
    const contact = Contact.discover(
      baseContactProps({
        emailFingerprint: 'h1_abc',
        encryptedEmail: 'e1_xyz',
        phoneFingerprint: 'h1_def',
        encryptedPhone: 'e1_uvw',
      }),
      'test-source',
      asCorrelationId('c'),
      asEventId('e'),
    );
    pool.client.queueResult([]);

    await repo.save(ctx, contact);

    const q = getNonConfigQueries(pool.client)[0];
    // Should NOT contain plaintext column names
    expect(q.sql).not.toMatch(/\bemail\b/);
    expect(q.sql).not.toMatch(/\bphone\b/);
    // Should contain protected column names
    expect(q.sql).toContain('email_fingerprint');
    expect(q.sql).toContain('encrypted_email');
    expect(q.sql).toContain('phone_fingerprint');
    expect(q.sql).toContain('encrypted_phone');
  });

  // -- READ RECONSTITUTION ------------------------------------------------

  it('read reconstitutes exact Contact state with zero domain events', async () => {
    const ctx = makeCtx();
    const original = Contact.discover(
      baseContactProps({
        emailFingerprint: 'h1_abc',
        encryptedEmail: 'e1_xyz',
        phoneFingerprint: 'h1_def',
        encryptedPhone: 'e1_uvw',
        evidenceReferences: [asEvidenceId('ev-1')],
      }),
      'test-source',
      asCorrelationId('c'),
      asEventId('e'),
    );
    const row = makeRow(original);
    pool.client.queueResult([row]);

    const found = await repo.findById(ctx, 'con-1');

    expect(found).not.toBeNull();
    expect(found!.id).toBe(original.id);
    expect(found!.tenantId).toBe(original.tenantId);
    expect(found!.workspaceId).toBe(original.workspaceId);
    expect(found!.accountId).toBe(original.accountId);
    expect(found!.name).toBe(original.name);
    expect(found!.emailFingerprint).toBe(original.emailFingerprint);
    expect(found!.encryptedEmail).toBe(original.encryptedEmail);
    expect(found!.phoneFingerprint).toBe(original.phoneFingerprint);
    expect(found!.encryptedPhone).toBe(original.encryptedPhone);
    expect(found!.channels).toEqual(original.channels);
    expect(found!.evidenceReferences).toEqual(original.evidenceReferences);
    expect(found!.version).toBe(original.version);

    // Zero domain events after hydration
    expect(found!.domainEvents).toHaveLength(0);
  });

  // -- FIND_BY_ID TENANT+WORKSPACE PREDICATES -----------------------------

  it('findById includes tenant_id and workspace_id in SQL', async () => {
    const ctx = makeCtx('t-abc', 'ws-xyz');
    pool.client.queueResult([]);

    await repo.findById(ctx, 'con-test');

    const q = getNonConfigQueries(pool.client)[0];
    expect(q.sql).toContain('tenant_id = $1');
    expect(q.sql).toContain('workspace_id = $2');
    expect(q.sql).toContain('contact_id = $3');
    expect(q.params[0]).toBe('t-abc');
    expect(q.params[1]).toBe('ws-xyz');
    expect(q.params[2]).toBe('con-test');
  });

  // -- FIND_BY_ACCOUNT TENANT+WORKSPACE+ACCOUNT PREDICATES ----------------

  it('findByAccount includes tenant_id, workspace_id, and account_id in SQL', async () => {
    const ctx = makeCtx('t-fba', 'ws-fba');
    pool.client.queueResult([]);

    await repo.findByAccount(ctx, 'acc-test');

    const q = getNonConfigQueries(pool.client)[0];
    expect(q.sql).toContain('tenant_id = $1');
    expect(q.sql).toContain('workspace_id = $2');
    expect(q.sql).toContain('account_id = $3');
    expect(q.params[0]).toBe('t-fba');
    expect(q.params[1]).toBe('ws-fba');
    expect(q.params[2]).toBe('acc-test');
  });

  // -- WRITE OWNERSHIP MISMATCH ISSUES NO SQL -----------------------------

  it('save with workspace mismatch issues no SQL', async () => {
    const ctx = makeCtx('tenant-1', 'ws-wrong');
    const contact = Contact.discover(
      baseContactProps({ workspaceId: 'ws-1' }),
      'test-source',
      asCorrelationId('c'),
      asEventId('e'),
    );

    await expect(repo.save(ctx, contact)).rejects.toThrow(AuthorizationError);

    // Only set_config queries (from withTenant), no INSERT/UPDATE
    const dataQueries = getNonConfigQueries(pool.client);
    expect(dataQueries).toHaveLength(0);
  });

  it('save with tenant mismatch issues no SQL', async () => {
    const ctx = makeCtx('tenant-wrong', 'ws-1');
    const contact = Contact.discover(
      baseContactProps({ tenantId: asTenantId('tenant-1') }),
      'test-source',
      asCorrelationId('c'),
      asEventId('e'),
    );

    await expect(repo.save(ctx, contact)).rejects.toThrow(TenantIsolationError);

    const dataQueries = getNonConfigQueries(pool.client);
    expect(dataQueries).toHaveLength(0);
  });

  // -- SUPPRESSION STATE ROUND TRIP ---------------------------------------

  it('SUPPRESSED state round-trips', async () => {
    const ctx = makeCtx();
    const row: FakeRow = {
      contact_id: 'con-sup',
      tenant_id: 'tenant-1',
      workspace_id: 'ws-1',
      account_id: 'acc-1',
      name: 'Suppressed Contact',
      title: null,
      role: null,
      seniority: null,
      department: null,
      function_role: null,
      email_fingerprint: null,
      encrypted_email: null,
      phone_fingerprint: null,
      encrypted_phone: null,
      linked_in_url: null,
      channels: [],
      consent_status: null,
      verification_state: 'UNVERIFIED',
      status: 'SUPPRESSED',
      suppression_reason: 'BOUNCED',
      suppression_reference: 'ref-123',
      suppressed_at: FIXED_DATE,
      evidence_references: [],
      contact_version: 1,
      created_at: FIXED_DATE,
      updated_at: FIXED_DATE,
    };
    pool.client.queueResult([row]);

    const found = await repo.findById(ctx, 'con-sup');
    expect(found!.status).toBe('SUPPRESSED');
    expect(found!.suppressionReason).toBe('BOUNCED');
    expect(found!.suppressionReference).toBe('ref-123');
    expect(found!.suppressedAt).toEqual(FIXED_DATE);
  });

  // -- VERIFICATION STATE ROUND TRIP --------------------------------------

  it('BOUNCED verification state round-trips', async () => {
    const ctx = makeCtx();
    const row = makeRow(
      Contact.discover(baseContactProps(), 'test-source', asCorrelationId('c'), asEventId('e')),
      { verification_state: 'BOUNCED' },
    );
    pool.client.queueResult([row]);

    const found = await repo.findById(ctx, 'con-1');
    expect(found!.verificationState).toBe('BOUNCED');
  });

  // -- EVIDENCE REFERENCES ROUND TRIP -------------------------------------

  it('evidence references round-trip', async () => {
    const ctx = makeCtx();
    const evRefs = [asEvidenceId('ev-1'), asEvidenceId('ev-2')];
    const row = makeRow(
      Contact.discover(baseContactProps(), 'test-source', asCorrelationId('c'), asEventId('e')),
      { evidence_references: evRefs },
    );
    pool.client.queueResult([row]);

    const found = await repo.findById(ctx, 'con-1');
    expect(found!.evidenceReferences).toEqual(evRefs);
  });

  // -- VERSION SEMANTICS --------------------------------------------------

  it('fresh Contact INSERT writes current aggregate version', async () => {
    const ctx = makeCtx();
    const contact = Contact.discover(
      baseContactProps(),
      'test-source',
      asCorrelationId('c'),
      asEventId('e'),
    );
    expect(contact.version).toBe(1);

    pool.client.queueResult([]); // INSERT

    await repo.save(ctx, contact);

    const q = getNonConfigQueries(pool.client)[0];
    expect(q.params[23]).toBe(1); // $24 = contact_version
  });

  it('INSERT establishes loadedVersion', async () => {
    const ctx = makeCtx();
    const contact = Contact.discover(
      baseContactProps(),
      'test-source',
      asCorrelationId('c'),
      asEventId('e'),
    );
    expect(contact.loadedVersion).toBeUndefined();

    pool.client.queueResult([]); // INSERT

    await repo.save(ctx, contact);

    expect(contact.loadedVersion).toBe(contact.version);
    expect(contact.loadedVersion).toBe(1);
  });

  it('UPDATE WHERE uses expected loaded version, SET uses current version', async () => {
    const ctx = makeCtx();
    const contact = Contact.reconstitute(
      baseContactProps(),
      2,
    );
    expect(contact.loadedVersion).toBe(2);
    expect(contact.version).toBe(2);

    // Domain mutation increments version to 3
    contact.suppress('BOUNCED', asCorrelationId('c'), asEventId('e'), 'ref');
    expect(contact.version).toBe(3);
    expect(contact.loadedVersion).toBe(2);

    pool.client.queueResult([{ rowCount: 1 } as any]); // UPDATE succeeds

    await repo.save(ctx, contact);

    const q = getNonConfigQueries(pool.client)[0];
    expect(q.sql).toContain('UPDATE intelligence.contacts');
    expect(q.params[3]).toBe(2); // $4 = WHERE contact_version (expected)
    expect(q.params[23]).toBe(3); // $24 = SET contact_version (new)
  });

  it('successful UPDATE advances loaded baseline', async () => {
    const ctx = makeCtx();
    const contact = Contact.reconstitute(
      baseContactProps(),
      2,
    );
    contact.suppress('BOUNCED', asCorrelationId('c'), asEventId('e'), 'ref');

    pool.client.queueResult([{ rowCount: 1 } as any]);

    await repo.save(ctx, contact);

    expect(contact.loadedVersion).toBe(contact.version);
    expect(contact.loadedVersion).toBe(3);
  });

  it('zero-row UPDATE maps to ConcurrencyConflictError', async () => {
    const ctx = makeCtx();
    const contact = Contact.reconstitute(
      baseContactProps(),
      2,
    );
    contact.suppress('BOUNCED', asCorrelationId('c'), asEventId('e'), 'ref');

    pool.client.queueResult([]); // UPDATE returns 0 rows

    await expect(repo.save(ctx, contact)).rejects.toThrow(ConcurrencyConflictError);
  });

  it('repository never increments version itself', async () => {
    const ctx = makeCtx();
    const contact = Contact.discover(
      baseContactProps(),
      'test-source',
      asCorrelationId('c'),
      asEventId('e'),
    );
    expect(contact.version).toBe(1);

    pool.client.queueResult([]); // INSERT

    await repo.save(ctx, contact);

    const q = getNonConfigQueries(pool.client)[0];
    expect(q.params[23]).toBe(1); // contact_version param must equal exactly what aggregate has
    expect(contact.version).toBe(1); // repo did not change it
  });

  // -- DUPLICATE CLASSIFICATION -------------------------------------------

  it('email duplicate on INSERT → DuplicateRecordError with email_fingerprint', async () => {
    const ctx = makeCtx();
    const contact = Contact.discover(
      baseContactProps(),
      'test-source',
      asCorrelationId('c'),
      asEventId('e'),
    );

    const pgErr = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'contacts_workspace_account_email_fingerprint_dedup',
    });
    pool.client.queueResult([], pgErr);

    const err = await repo.save(ctx, contact).catch((e) => e);
    expect(err).toBeInstanceOf(DuplicateRecordError);
    expect(err.conflictField).toBe('email_fingerprint');
  });

  it('phone duplicate on INSERT → DuplicateRecordError with phone_fingerprint', async () => {
    const ctx = makeCtx();
    const contact = Contact.discover(
      baseContactProps(),
      'test-source',
      asCorrelationId('c'),
      asEventId('e'),
    );

    const pgErr = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'contacts_workspace_account_phone_fingerprint_dedup',
    });
    pool.client.queueResult([], pgErr);

    const err = await repo.save(ctx, contact).catch((e) => e);
    expect(err).toBeInstanceOf(DuplicateRecordError);
    expect(err.conflictField).toBe('phone_fingerprint');
  });

  it('PK duplicate on INSERT → ConcurrencyConflictError', async () => {
    const ctx = makeCtx();
    const contact = Contact.discover(
      baseContactProps(),
      'test-source',
      asCorrelationId('c'),
      asEventId('e'),
    );

    const pgErr = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'contacts_pkey',
    });
    pool.client.queueResult([], pgErr);

    await expect(repo.save(ctx, contact)).rejects.toThrow(ConcurrencyConflictError);
  });

  it('email duplicate on UPDATE → DuplicateRecordError with email_fingerprint', async () => {
    const ctx = makeCtx();
    const contact = Contact.reconstitute(
      baseContactProps(),
      1,
    );
    contact.suppress('BOUNCED', asCorrelationId('c'), asEventId('e'), 'ref');

    const pgErr = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'contacts_workspace_account_email_fingerprint_dedup',
    });
    pool.client.queueResult([], pgErr);

    const err = await repo.save(ctx, contact).catch((e) => e);
    expect(err).toBeInstanceOf(DuplicateRecordError);
    expect(err.conflictField).toBe('email_fingerprint');
  });

  it('phone duplicate on UPDATE → DuplicateRecordError with phone_fingerprint', async () => {
    const ctx = makeCtx();
    const contact = Contact.reconstitute(
      baseContactProps(),
      1,
    );
    contact.suppress('BOUNCED', asCorrelationId('c'), asEventId('e'), 'ref');

    const pgErr = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'contacts_workspace_account_phone_fingerprint_dedup',
    });
    pool.client.queueResult([], pgErr);

    const err = await repo.save(ctx, contact).catch((e) => e);
    expect(err).toBeInstanceOf(DuplicateRecordError);
    expect(err.conflictField).toBe('phone_fingerprint');
  });

  // -- SQL PARAMETERIZATION -----------------------------------------------

  it('SQL uses $N parameters, not interpolated values', async () => {
    const ctx = makeCtx('my-tenant', 'my-workspace');
    const contact = Contact.discover(
      baseContactProps({ tenantId: asTenantId('my-tenant'), workspaceId: 'my-workspace' }),
      'test-source',
      asCorrelationId('c'),
      asEventId('e'),
    );
    pool.client.queueResult([]);

    await repo.save(ctx, contact);

    const q = getNonConfigQueries(pool.client)[0];
    // SQL text must not contain actual tenant/workspace/account values
    expect(q.sql).not.toContain('my-tenant');
    expect(q.sql).not.toContain('my-workspace');
    expect(q.sql).not.toContain('con-1');
    // Must use $N placeholders
    expect(q.sql).toMatch(/\$\d+/);
  });
});
