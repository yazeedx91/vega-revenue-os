import { Pool } from 'pg';
import { Contact } from '@projectx/domain';
import { asContactId, asAccountId, asTenantId, asCorrelationId, asEventId, asEvidenceId } from '@projectx/shared';
import { PostgresContactRepository } from '@projectx/intelligence';
import { ConcurrencyConflictError, DuplicateRecordError } from '@projectx/infrastructure';
import { DEFAULT_ADMIN_DATABASE_URL, DEFAULT_APP_DATABASE_URL, getAdminDatabaseUrl } from './integration-config';
import { runMigrations } from './helpers';

// ---------------------------------------------------------------------------
// Deterministic fixtures (isolated for 8B2d)
// ---------------------------------------------------------------------------
const TENANT_A = 'tenant-8b2d-a';
const TENANT_B = 'tenant-8b2d-b';

const WS_A1 = 'b3000000-0000-0000-0000-000000000001';
const WS_A2 = 'b3000000-0000-0000-0000-000000000002';
const WS_B1 = 'b3000000-0000-0000-0000-000000000003';

const USER_A = 'c2000000-0000-0000-0000-00000000d001';
const USER_B = 'c2000000-0000-0000-0000-00000000d002';

const ACC_A1 = 'acc-8b2d-a1';
const ACC_A2 = 'acc-8b2d-a2';
const ACC_B1 = 'acc-8b2d-b1';
const ACC_A1_UNIQUE = 'acc-8b2d-a1-unique';
const ACC_A1_FIND = 'acc-8b2d-a1-find';
const ACC_A2_FIND = 'acc-8b2d-a2-find';

// Opaque protected values (not cryptographically validated by DB)
const EMAIL_FP_ROUNDTRIP = 'h1.v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const EMAIL_FP_OPAQUE = 'h1.v1.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const EMAIL_FP_DEDUP = 'h1.v1.CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
const EMAIL_FP_CIPHER_1 = 'h1.v1.DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
const EMAIL_FP_CIPHER_2 = 'h1.v1.EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE';
const CIPHER_1 = 'e1.v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const CIPHER_2 = 'e1.v1.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const PHONE_FP_ROUNDTRIP = 'h1.v1.FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF';
const PHONE_FP_OPAQUE = 'h1.v1.GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG';
const PHONE_FP_DEDUP = 'h1.v1.HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH';
const PHONE_CIPHER_1 = 'e1.v1.CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
const PHONE_CIPHER_2 = 'e1.v1.DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';

describe('Slice 8B2d — Live Contact Persistence and Concurrency', () => {
  let adminPool: Pool;
  let appPool: Pool;
  let repo: PostgresContactRepository;

  beforeAll(async () => {
    await runMigrations(getAdminDatabaseUrl());
    adminPool = new Pool({ connectionString: DEFAULT_ADMIN_DATABASE_URL });
    appPool = new Pool({ connectionString: DEFAULT_APP_DATABASE_URL });
    repo = new PostgresContactRepository(appPool);

    // Create deterministic workspaces, users, accounts
    await adminPool.query('BEGIN');
    try {
      // Users
      await adminPool.query(
        `INSERT INTO identity.users (id, email, name, tenant_id) VALUES ($1, 'user-8b2d-a@test.com', 'User A', $2) ON CONFLICT (id) DO NOTHING`,
        [USER_A, TENANT_A],
      );
      await adminPool.query(
        `INSERT INTO identity.users (id, email, name, tenant_id) VALUES ($1, 'user-8b2d-b@test.com', 'User B', $2) ON CONFLICT (id) DO NOTHING`,
        [USER_B, TENANT_B],
      );

      // Workspaces
      await adminPool.query(
        `INSERT INTO identity.workspaces (id, tenant_id, name, owner_user_id) VALUES ($1, $2, 'WS A1', $3) ON CONFLICT DO NOTHING`,
        [WS_A1, TENANT_A, USER_A],
      );
      await adminPool.query(
        `INSERT INTO identity.workspaces (id, tenant_id, name, owner_user_id) VALUES ($1, $2, 'WS A2', $3) ON CONFLICT DO NOTHING`,
        [WS_A2, TENANT_A, USER_A],
      );
      await adminPool.query(
        `INSERT INTO identity.workspaces (id, tenant_id, name, owner_user_id) VALUES ($1, $2, 'WS B1', $3) ON CONFLICT DO NOTHING`,
        [WS_B1, TENANT_B, USER_B],
      );

      // Accounts
      await adminPool.query(
        `INSERT INTO intelligence.accounts (account_id, tenant_id, workspace_id, name, normalized_domain, status) VALUES ($1, $2, $3, 'Account A1', 'a1.com', 'DISCOVERED') ON CONFLICT DO NOTHING`,
        [ACC_A1, TENANT_A, WS_A1],
      );
      await adminPool.query(
        `INSERT INTO intelligence.accounts (account_id, tenant_id, workspace_id, name, normalized_domain, status) VALUES ($1, $2, $3, 'Account A1 Unique', 'a1u.com', 'DISCOVERED') ON CONFLICT DO NOTHING`,
        [ACC_A1_UNIQUE, TENANT_A, WS_A1],
      );
      await adminPool.query(
        `INSERT INTO intelligence.accounts (account_id, tenant_id, workspace_id, name, normalized_domain, status) VALUES ($1, $2, $3, 'Account A1 Find', 'a1f.com', 'DISCOVERED') ON CONFLICT DO NOTHING`,
        [ACC_A1_FIND, TENANT_A, WS_A1],
      );
      await adminPool.query(
        `INSERT INTO intelligence.accounts (account_id, tenant_id, workspace_id, name, normalized_domain, status) VALUES ($1, $2, $3, 'Account A2', 'a2.com', 'DISCOVERED') ON CONFLICT DO NOTHING`,
        [ACC_A2, TENANT_A, WS_A2],
      );
      await adminPool.query(
        `INSERT INTO intelligence.accounts (account_id, tenant_id, workspace_id, name, normalized_domain, status) VALUES ($1, $2, $3, 'Account A2 Find', 'a2f.com', 'DISCOVERED') ON CONFLICT DO NOTHING`,
        [ACC_A2_FIND, TENANT_A, WS_A2],
      );
      await adminPool.query(
        `INSERT INTO intelligence.accounts (account_id, tenant_id, workspace_id, name, normalized_domain, status) VALUES ($1, $2, $3, 'Account B1', 'b1.com', 'DISCOVERED') ON CONFLICT DO NOTHING`,
        [ACC_B1, TENANT_B, WS_B1],
      );

      await adminPool.query('COMMIT');
    } catch (e) {
      await adminPool.query('ROLLBACK');
      throw e;
    }
  });

  afterAll(async () => {
    // Cleanup in FK-safe order
    await adminPool.query('BEGIN');
    try {
      await adminPool.query(`DELETE FROM intelligence.contacts WHERE contact_id LIKE 'contact-8b2d-%'`);
      await adminPool.query(`DELETE FROM intelligence.accounts WHERE account_id LIKE 'acc-8b2d-%'`);
      await adminPool.query(`DELETE FROM identity.workspaces WHERE id = $1`, [WS_A1]);
      await adminPool.query(`DELETE FROM identity.workspaces WHERE id = $1`, [WS_A2]);
      await adminPool.query(`DELETE FROM identity.workspaces WHERE id = $1`, [WS_B1]);
      await adminPool.query(`DELETE FROM identity.users WHERE id = $1`, [USER_A]);
      await adminPool.query(`DELETE FROM identity.users WHERE id = $1`, [USER_B]);
      await adminPool.query('COMMIT');
    } catch (e) {
      await adminPool.query('ROLLBACK');
      throw e;
    } finally {
      await adminPool.end();
      await appPool.end();
    }
  });

  // 1. Full protected Contact round trip
  it('full protected Contact round trip through repository', async () => {
    const ctx = {
      tenantId: asTenantId(TENANT_A),
      correlationId: asCorrelationId('corr-1'),
      workspaceId: WS_A1,
    };

    const original = Contact.discover(
      {
        id: asContactId('contact-8b2d-roundtrip'),
        tenantId: asTenantId(TENANT_A),
        workspaceId: WS_A1,
        accountId: asAccountId(ACC_A1),
        name: 'Alice Smith',
        title: 'CTO',
        role: 'Engineering',
        seniority: 'VP',
        department: 'Engineering',
        functionRole: 'Technology Leadership',
        emailFingerprint: EMAIL_FP_ROUNDTRIP,
        encryptedEmail: CIPHER_1,
        phoneFingerprint: PHONE_FP_ROUNDTRIP,
        encryptedPhone: PHONE_CIPHER_1,
        linkedInUrl: 'https://linkedin.com/in/alice',
        channels: ['email', 'linkedin'],
        consentStatus: 'GRANTED',
        verificationState: 'UNVERIFIED',
        status: 'DISCOVERED',
        suppressionReason: null,
        suppressionReference: null,
        suppressedAt: null,
        evidenceReferences: [asEvidenceId('ev-1'), asEvidenceId('ev-2')],
      },
      'test-source',
      asCorrelationId('corr-1'),
      asEventId('evt-1'),
    );

    await repo.save(ctx, original);

    const reloaded = await repo.findById(ctx, asContactId('contact-8b2d-roundtrip'));
    expect(reloaded).not.toBeNull();

    // Verify all fields round-trip
    expect(reloaded!.id).toBe(original.id);
    expect(reloaded!.tenantId).toBe(original.tenantId);
    expect(reloaded!.workspaceId).toBe(original.workspaceId);
    expect(reloaded!.accountId).toBe(original.accountId);
    expect(reloaded!.name).toBe(original.name);
    expect(reloaded!.title).toBe(original.title);
    expect(reloaded!.role).toBe(original.role);
    expect(reloaded!.seniority).toBe(original.seniority);
    expect(reloaded!.department).toBe(original.department);
    expect(reloaded!.functionRole).toBe(original.functionRole);
    expect(reloaded!.emailFingerprint).toBe(original.emailFingerprint);
    expect(reloaded!.encryptedEmail).toBe(original.encryptedEmail);
    expect(reloaded!.phoneFingerprint).toBe(original.phoneFingerprint);
    expect(reloaded!.encryptedPhone).toBe(original.encryptedPhone);
    expect(reloaded!.linkedInUrl).toBe(original.linkedInUrl);
    expect(reloaded!.channels).toEqual(original.channels);
    expect(reloaded!.consentStatus).toBe(original.consentStatus);
    expect(reloaded!.verificationState).toBe(original.verificationState);
    expect(reloaded!.status).toBe(original.status);
    expect(reloaded!.suppressionReason).toBe(original.suppressionReason);
    expect(reloaded!.suppressionReference).toBe(original.suppressionReference);
    expect(reloaded!.suppressedAt ?? null).toBe(original.suppressedAt ?? null);
    expect(reloaded!.evidenceReferences).toEqual(original.evidenceReferences);
    expect(reloaded!.version).toBe(original.version);
    expect(reloaded!.loadedVersion).toBe(original.version);

    // Hydration emits zero domain events
    expect(reloaded!.domainEvents).toHaveLength(0);
  });

  // 2. Protected strings remain opaque and unchanged
  it('protected strings pass through unchanged', async () => {
    const ctx = {
      tenantId: asTenantId(TENANT_A),
      correlationId: asCorrelationId('corr-2'),
      workspaceId: WS_A1,
    };

    const contact = Contact.discover(
      {
        id: asContactId('contact-8b2d-opaque'),
        tenantId: asTenantId(TENANT_A),
        workspaceId: WS_A1,
        accountId: asAccountId(ACC_A1_UNIQUE),
        emailFingerprint: EMAIL_FP_OPAQUE,
        encryptedEmail: CIPHER_1,
        phoneFingerprint: PHONE_FP_OPAQUE,
        encryptedPhone: PHONE_CIPHER_1,
      },
      'test-source',
      asCorrelationId('corr-2'),
      asEventId('evt-2'),
    );

    await repo.save(ctx, contact);

    const reloaded = await repo.findById(ctx, asContactId('contact-8b2d-opaque'));
    expect(reloaded!.emailFingerprint).toBe(EMAIL_FP_OPAQUE);
    expect(reloaded!.encryptedEmail).toBe(CIPHER_1);
    expect(reloaded!.phoneFingerprint).toBe(PHONE_FP_OPAQUE);
    expect(reloaded!.encryptedPhone).toBe(PHONE_CIPHER_1);
  });

  // 3. Same-tenant workspace isolation
  it('same-tenant workspace isolation: Contact in A1 visible from A1, not from A2', async () => {
    const ctxA1 = {
      tenantId: asTenantId(TENANT_A),
      correlationId: asCorrelationId('corr-3'),
      workspaceId: WS_A1,
    };

    const ctxA2 = {
      tenantId: asTenantId(TENANT_A),
      correlationId: asCorrelationId('corr-3'),
      workspaceId: WS_A2,
    };

    const contact = Contact.discover(
      {
        id: asContactId('contact-8b2d-ws-iso'),
        tenantId: asTenantId(TENANT_A),
        workspaceId: WS_A1,
        accountId: asAccountId(ACC_A1),
      },
      'test-source',
      asCorrelationId('corr-3'),
      asEventId('evt-3'),
    );

    await repo.save(ctxA1, contact);

    const foundA1 = await repo.findById(ctxA1, asContactId('contact-8b2d-ws-iso'));
    expect(foundA1).not.toBeNull();

    const foundA2 = await repo.findById(ctxA2, asContactId('contact-8b2d-ws-iso'));
    expect(foundA2).toBeNull();
  });

  // 4. Independent tenant RLS proof
  it('independent tenant RLS: Tenant B cannot see Tenant A Contact via direct query', async () => {
    const ctxA = {
      tenantId: asTenantId(TENANT_A),
      correlationId: asCorrelationId('corr-4'),
      workspaceId: WS_A1,
    };

    const contact = Contact.discover(
      {
        id: asContactId('contact-8b2d-rls'),
        tenantId: asTenantId(TENANT_A),
        workspaceId: WS_A1,
        accountId: asAccountId(ACC_A1),
      },
      'test-source',
      asCorrelationId('corr-4'),
      asEventId('evt-4'),
    );

    await repo.save(ctxA, contact);

    // Direct query under Tenant B context (no tenant predicate)
    await appPool.query(`SET app.current_tenant = '${TENANT_B}'`);
    const result = await appPool.query(
      `SELECT * FROM intelligence.contacts WHERE contact_id = $1`,
      ['contact-8b2d-rls'],
    );

    expect(result.rows.length).toBe(0);
  });

  // 5. Contact→Account ownership FK
  it('Contact→Account ownership FK rejects cross-workspace account', async () => {
    // Admin setup path for FK proof
    await expect(
      adminPool.query(
        `INSERT INTO intelligence.contacts (contact_id, tenant_id, workspace_id, account_id, status, verification_state)
         VALUES ($1, $2, $3, $4, 'DISCOVERED', 'UNVERIFIED')`,
        ['contact-8b2d-fk-ws', TENANT_A, WS_A1, ACC_A2], // WS_A1 pointing to ACC_A2 (in WS_A2)
      ),
    ).rejects.toThrow(/foreign key constraint/);
  });

  it('Contact→Account ownership FK rejects cross-tenant account', async () => {
    await expect(
      adminPool.query(
        `INSERT INTO intelligence.contacts (contact_id, tenant_id, workspace_id, account_id, status, verification_state)
         VALUES ($1, $2, $3, $4, 'DISCOVERED', 'UNVERIFIED')`,
        ['contact-8b2d-fk-tenant', TENANT_A, WS_A1, ACC_B1], // Tenant A pointing to Tenant B account
      ),
    ).rejects.toThrow(/foreign key constraint/);
  });

  // 6. Email fingerprint dedup
  it('email fingerprint dedup: same tenant/workspace/account/fingerprint throws DuplicateRecordError', async () => {
    const ctx = {
      tenantId: asTenantId(TENANT_A),
      correlationId: asCorrelationId('corr-5'),
      workspaceId: WS_A1,
    };

    const contact1 = Contact.discover(
      {
        id: asContactId('contact-8b2d-email-dup-1'),
        tenantId: asTenantId(TENANT_A),
        workspaceId: WS_A1,
        accountId: asAccountId(ACC_A1_UNIQUE),
        emailFingerprint: EMAIL_FP_DEDUP,
      },
      'test-source',
      asCorrelationId('corr-5'),
      asEventId('evt-5'),
    );

    await repo.save(ctx, contact1);

    const contact2 = Contact.discover(
      {
        id: asContactId('contact-8b2d-email-dup-2'),
        tenantId: asTenantId(TENANT_A),
        workspaceId: WS_A1,
        accountId: asAccountId(ACC_A1_UNIQUE),
        emailFingerprint: EMAIL_FP_DEDUP, // Same fingerprint
      },
      'test-source',
      asCorrelationId('corr-5'),
      asEventId('evt-6'),
    );

    const err = await repo.save(ctx, contact2).catch((e) => e);
    expect(err).toHaveProperty('conflictField', 'email_fingerprint');
  });

  // 7. Phone fingerprint dedup
  it('phone fingerprint dedup: same tenant/workspace/account/fingerprint throws DuplicateRecordError', async () => {
    const ctx = {
      tenantId: asTenantId(TENANT_A),
      correlationId: asCorrelationId('corr-6'),
      workspaceId: WS_A1,
    };

    const contact1 = Contact.discover(
      {
        id: asContactId('contact-8b2d-phone-dup-1'),
        tenantId: asTenantId(TENANT_A),
        workspaceId: WS_A1,
        accountId: asAccountId(ACC_A1_UNIQUE),
        phoneFingerprint: PHONE_FP_DEDUP,
      },
      'test-source',
      asCorrelationId('corr-6'),
      asEventId('evt-7'),
    );

    await repo.save(ctx, contact1);

    const contact2 = Contact.discover(
      {
        id: asContactId('contact-8b2d-phone-dup-2'),
        tenantId: asTenantId(TENANT_A),
        workspaceId: WS_A1,
        accountId: asAccountId(ACC_A1_UNIQUE),
        phoneFingerprint: PHONE_FP_DEDUP, // Same fingerprint
      },
      'test-source',
      asCorrelationId('corr-6'),
      asEventId('evt-8'),
    );

    const err = await repo.save(ctx, contact2).catch((e) => e);
    expect(err).toHaveProperty('conflictField', 'phone_fingerprint');
  });

  // 8. Ciphertext is not unique
  it('same ciphertext with different fingerprints persists', async () => {
    const ctx = {
      tenantId: asTenantId(TENANT_A),
      correlationId: asCorrelationId('corr-7'),
      workspaceId: WS_A1,
    };

    const contact1 = Contact.discover(
      {
        id: asContactId('contact-8b2d-cipher-1'),
        tenantId: asTenantId(TENANT_A),
        workspaceId: WS_A1,
        accountId: asAccountId(ACC_A1_UNIQUE),
        emailFingerprint: EMAIL_FP_CIPHER_1,
        encryptedEmail: CIPHER_1,
      },
      'test-source',
      asCorrelationId('corr-7'),
      asEventId('evt-9'),
    );

    await repo.save(ctx, contact1);

    const contact2 = Contact.discover(
      {
        id: asContactId('contact-8b2d-cipher-2'),
        tenantId: asTenantId(TENANT_A),
        workspaceId: WS_A1,
        accountId: asAccountId(ACC_A1_UNIQUE),
        emailFingerprint: EMAIL_FP_CIPHER_2, // Different fingerprint
        encryptedEmail: CIPHER_1, // Same ciphertext
      },
      'test-source',
      asCorrelationId('corr-7'),
      asEventId('evt-10'),
    );

    await expect(repo.save(ctx, contact2)).resolves.not.toThrow();
  });

  // 9. NULL protected-channel behavior
  it('multiple Contacts with NULL protected channels persist', async () => {
    const ctx = {
      tenantId: asTenantId(TENANT_A),
      correlationId: asCorrelationId('corr-8'),
      workspaceId: WS_A1,
    };

    const contact1 = Contact.discover(
      {
        id: asContactId('contact-8b2d-null-1'),
        tenantId: asTenantId(TENANT_A),
        workspaceId: WS_A1,
        accountId: asAccountId(ACC_A1_UNIQUE),
        emailFingerprint: null,
        phoneFingerprint: null,
      },
      'test-source',
      asCorrelationId('corr-8'),
      asEventId('evt-11'),
    );

    const contact2 = Contact.discover(
      {
        id: asContactId('contact-8b2d-null-2'),
        tenantId: asTenantId(TENANT_A),
        workspaceId: WS_A1,
        accountId: asAccountId(ACC_A1_UNIQUE),
        emailFingerprint: null,
        phoneFingerprint: null,
      },
      'test-source',
      asCorrelationId('corr-8'),
      asEventId('evt-12'),
    );

    await repo.save(ctx, contact1);
    await expect(repo.save(ctx, contact2)).resolves.not.toThrow();
  });

  // 10. Real optimistic concurrency
  it('real optimistic concurrency: stale write throws ConcurrencyConflictError', async () => {
    const ctx = {
      tenantId: asTenantId(TENANT_A),
      correlationId: asCorrelationId('corr-9'),
      workspaceId: WS_A1,
    };

    const contact = Contact.discover(
      {
        id: asContactId('contact-8b2d-occ'),
        tenantId: asTenantId(TENANT_A),
        workspaceId: WS_A1,
        accountId: asAccountId(ACC_A1_UNIQUE),
      },
      'test-source',
      asCorrelationId('corr-9'),
      asEventId('evt-13'),
    );

    await repo.save(ctx, contact);

    // Load A
    const contactA = await repo.findById(ctx, asContactId('contact-8b2d-occ'));
    expect(contactA!.loadedVersion).toBe(1);

    // Load B
    const contactB = await repo.findById(ctx, asContactId('contact-8b2d-occ'));
    expect(contactB!.loadedVersion).toBe(1);

    // Mutate A
    contactA!.enrich({ title: 'CTO' }, [asEvidenceId('ev-3')], asCorrelationId('corr-9'), asEventId('evt-14'));
    expect(contactA!.version).toBe(2);

    // Save A succeeds
    await repo.save(ctx, contactA!);
    expect(contactA!.loadedVersion).toBe(2);

    // Mutate B
    contactB!.enrich({ title: 'VP Engineering' }, [asEvidenceId('ev-4')], asCorrelationId('corr-9'), asEventId('evt-15'));
    expect(contactB!.version).toBe(2);

    // Save B fails
    await expect(repo.save(ctx, contactB!)).rejects.toThrow(ConcurrencyConflictError);

    // Reload: winner A state present
    const final = await repo.findById(ctx, asContactId('contact-8b2d-occ'));
    expect(final!.title).toBe('CTO');
    expect(final!.version).toBe(2);
    expect(final!.loadedVersion).toBe(2);
  });

  // 11. SUPPRESSED persistence
  it('SUPPRESSED state with suppression details persists', async () => {
    const ctx = {
      tenantId: asTenantId(TENANT_A),
      correlationId: asCorrelationId('corr-10'),
      workspaceId: WS_A1,
    };

    const contact = Contact.discover(
      {
        id: asContactId('contact-8b2d-suppressed'),
        tenantId: asTenantId(TENANT_A),
        workspaceId: WS_A1,
        accountId: asAccountId(ACC_A1_UNIQUE),
      },
      'test-source',
      asCorrelationId('corr-10'),
      asEventId('evt-16'),
    );

    await repo.save(ctx, contact);

    contact.suppress('BOUNCED', asCorrelationId('corr-10'), asEventId('evt-17'), 'ref-123');
    await repo.save(ctx, contact);

    const reloaded = await repo.findById(ctx, asContactId('contact-8b2d-suppressed'));
    expect(reloaded!.status).toBe('SUPPRESSED');
    expect(reloaded!.suppressionReason).toBe('BOUNCED');
    expect(reloaded!.suppressionReference).toBe('ref-123');
    expect(reloaded!.suppressedAt).not.toBeNull();
  });

  // 12. BOUNCED persistence
  it('BOUNCED verification state persists', async () => {
    const ctx = {
      tenantId: asTenantId(TENANT_A),
      correlationId: asCorrelationId('corr-11'),
      workspaceId: WS_A1,
    };

    const contact = Contact.discover(
      {
        id: asContactId('contact-8b2d-bounced'),
        tenantId: asTenantId(TENANT_A),
        workspaceId: WS_A1,
        accountId: asAccountId(ACC_A1_UNIQUE),
      },
      'test-source',
      asCorrelationId('corr-11'),
      asEventId('evt-18'),
    );

    await repo.save(ctx, contact);

    contact.markBounced(asCorrelationId('corr-11'), asEventId('evt-19'));
    await repo.save(ctx, contact);

    const reloaded = await repo.findById(ctx, asContactId('contact-8b2d-bounced'));
    expect(reloaded!.verificationState).toBe('BOUNCED');
  });

  // 13. findByAccount workspace scope
  it('findByAccount returns only workspace-scoped Contacts', async () => {
    const ctxA1 = {
      tenantId: asTenantId(TENANT_A),
      correlationId: asCorrelationId('corr-12'),
      workspaceId: WS_A1,
    };

    const ctxA2 = {
      tenantId: asTenantId(TENANT_A),
      correlationId: asCorrelationId('corr-12'),
      workspaceId: WS_A2,
    };

    const contactA1 = Contact.discover(
      {
        id: asContactId('contact-8b2d-find-a1'),
        tenantId: asTenantId(TENANT_A),
        workspaceId: WS_A1,
        accountId: asAccountId(ACC_A1_FIND),
      },
      'test-source',
      asCorrelationId('corr-12'),
      asEventId('evt-20'),
    );

    const contactA2 = Contact.discover(
      {
        id: asContactId('contact-8b2d-find-a2'),
        tenantId: asTenantId(TENANT_A),
        workspaceId: WS_A2,
        accountId: asAccountId(ACC_A2_FIND),
      },
      'test-source',
      asCorrelationId('corr-12'),
      asEventId('evt-21'),
    );

    await repo.save(ctxA1, contactA1);
    await repo.save(ctxA2, contactA2);

    const foundA1 = await repo.findByAccount(ctxA1, asAccountId(ACC_A1_FIND));
    expect(foundA1).toHaveLength(1);
    expect(foundA1[0].id).toBe(asContactId('contact-8b2d-find-a1'));

    const foundA2 = await repo.findByAccount(ctxA2, asAccountId(ACC_A2_FIND));
    expect(foundA2).toHaveLength(1);
    expect(foundA2[0].id).toBe(asContactId('contact-8b2d-find-a2'));
  });

  // 14. App role / table safety
  it('projectx_app rolsuper is false', async () => {
    const result = await adminPool.query(`
      SELECT rolsuper
      FROM pg_roles
      WHERE rolname = 'projectx_app'
    `);
    expect(result.rows[0].rolsuper).toBe(false);
  });

  it('projectx_app rolbypassrls is false', async () => {
    const result = await adminPool.query(`
      SELECT rolbypassrls
      FROM pg_roles
      WHERE rolname = 'projectx_app'
    `);
    expect(result.rows[0].rolbypassrls).toBe(false);
  });

  it('contacts relrowsecurity is true', async () => {
    const result = await adminPool.query(`
      SELECT relrowsecurity
      FROM pg_class
      JOIN pg_namespace ON pg_class.relnamespace = pg_namespace.oid
      WHERE pg_namespace.nspname = 'intelligence' AND pg_class.relname = 'contacts'
    `);
    expect(result.rows[0].relrowsecurity).toBe(true);
  });

  it('contacts relforcerowsecurity is true', async () => {
    const result = await adminPool.query(`
      SELECT relforcerowsecurity
      FROM pg_class
      JOIN pg_namespace ON pg_class.relnamespace = pg_namespace.oid
      WHERE pg_namespace.nspname = 'intelligence' AND pg_class.relname = 'contacts'
    `);
    expect(result.rows[0].relforcerowsecurity).toBe(true);
  });
});
