import { Pool } from 'pg';
import { DEFAULT_ADMIN_DATABASE_URL, DEFAULT_APP_DATABASE_URL, getAdminDatabaseUrl } from './integration-config';
import { runMigrations } from './helpers';

// ---------------------------------------------------------------------------
// Deterministic fixtures (isolated for 8B2b)
// ---------------------------------------------------------------------------
const TENANT_A = 'tenant-8b2b-a';
const TENANT_B = 'tenant-8b2b-b';

const WS_A1 = 'b2000000-0000-0000-0000-000000000001';
const WS_A2 = 'b2000000-0000-0000-0000-000000000002';
const WS_B1 = 'b2000000-0000-0000-0000-000000000003';

const USER_A = 'c1000000-0000-0000-0000-00000000b001';
const USER_B = 'c1000000-0000-0000-0000-00000000b002';

const ACC_A1 = 'acc-8b2b-a1';
const ACC_A1B = 'acc-8b2b-a1b';
const ACC_A2 = 'acc-8b2b-a2';
const ACC_B1 = 'acc-8b2b-b1';

// Opaque protected values (not cryptographically validated by DB)
const EMAIL_FP_1 = 'h1.v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const EMAIL_FP_2 = 'h1.v1.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const EMAIL_FP_3 = 'h1.v1.DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
const EMAIL_FP_4 = 'h1.v1.EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE';
const CIPHER_1 = 'e1.v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const CIPHER_2 = 'e1.v1.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const PHONE_FP_1 = 'h1.v1.CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';

describe('Slice 8B2b/8B2c — Contact Schema with Concurrency', () => {
  let adminPool: Pool;
  let appPool: Pool;

  beforeAll(async () => {
    await runMigrations(getAdminDatabaseUrl());
    adminPool = new Pool({ connectionString: DEFAULT_ADMIN_DATABASE_URL });
    appPool = new Pool({ connectionString: DEFAULT_APP_DATABASE_URL });

    // Create deterministic workspaces, users, accounts
    await adminPool.query('BEGIN');
    try {
      // Users (tenant_id is a string reference, not a separate table)
      await adminPool.query(
        `INSERT INTO identity.users (id, email, name, tenant_id) VALUES ($1, 'user-a@test.com', 'User A', $2) ON CONFLICT (id) DO NOTHING`,
        [USER_A, TENANT_A],
      );
      await adminPool.query(
        `INSERT INTO identity.users (id, email, name, tenant_id) VALUES ($1, 'user-b@test.com', 'User B', $2) ON CONFLICT (id) DO NOTHING`,
        [USER_B, TENANT_B],
      );

      // Workspaces (real UUIDs)
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
        `INSERT INTO intelligence.accounts (account_id, tenant_id, workspace_id, name, normalized_domain, status) VALUES ($1, $2, $3, 'Account A1B', 'a1b.com', 'DISCOVERED') ON CONFLICT DO NOTHING`,
        [ACC_A1B, TENANT_A, WS_A1],
      );
      await adminPool.query(
        `INSERT INTO intelligence.accounts (account_id, tenant_id, workspace_id, name, normalized_domain, status) VALUES ($1, $2, $3, 'Account A2', 'a2.com', 'DISCOVERED') ON CONFLICT DO NOTHING`,
        [ACC_A2, TENANT_A, WS_A2],
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
      await adminPool.query(`DELETE FROM intelligence.contacts WHERE contact_id LIKE 'contact-8b2b-%'`);
      await adminPool.query(`DELETE FROM intelligence.accounts WHERE account_id LIKE 'acc-8b2b-%'`);
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

  // 1. Table exists
  it('intelligence.contacts exists', async () => {
    const result = await adminPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'intelligence' AND table_name = 'contacts'
      )
    `);
    expect(result.rows[0].exists).toBe(true);
  });

  // 2. All Contact columns present
  it('all exact frozen Contact persistence columns exist', async () => {
    const result = await adminPool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'intelligence' AND table_name = 'contacts'
      ORDER BY ordinal_position
    `);
    const columns = result.rows.map((r) => r.column_name);
    const expected = [
      'contact_id',
      'tenant_id',
      'workspace_id',
      'account_id',
      'name',
      'title',
      'role',
      'seniority',
      'department',
      'function_role',
      'email_fingerprint',
      'encrypted_email',
      'phone_fingerprint',
      'encrypted_phone',
      'linked_in_url',
      'channels',
      'consent_status',
      'verification_state',
      'status',
      'suppression_reason',
      'suppression_reference',
      'suppressed_at',
      'evidence_references',
      'created_at',
      'updated_at',
    ];
    expect(columns).toEqual(expected);
  });

  // 3. No plaintext email column
  it('no plaintext email column exists', async () => {
    const result = await adminPool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'intelligence' AND table_name = 'contacts'
        AND column_name IN ('email', 'email_address', 'raw_email')
    `);
    expect(result.rows.length).toBe(0);
  });

  // 4. No plaintext phone column
  it('no plaintext phone column exists', async () => {
    const result = await adminPool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'intelligence' AND table_name = 'contacts'
        AND column_name IN ('phone', 'phone_number', 'raw_phone')
    `);
    expect(result.rows.length).toBe(0);
  });

  // 5. Fingerprint/ciphertext are TEXT nullable
  it('protected fingerprint/ciphertext columns are TEXT nullable', async () => {
    const result = await adminPool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'intelligence' AND table_name = 'contacts'
        AND column_name IN ('email_fingerprint', 'encrypted_email', 'phone_fingerprint', 'encrypted_phone')
    `);
    result.rows.forEach((row) => {
      expect(row.data_type).toBe('text');
      expect(row.is_nullable).toBe('YES');
    });
  });

  // 6. Workspace ownership FK exists
  it('tenant/workspace ownership FK exists', async () => {
    const result = await adminPool.query(`
      SELECT
        tc.constraint_name,
        kcu.column_name,
        ccu.table_schema AS foreign_table_schema,
        ccu.table_name AS foreign_table_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.table_schema = 'intelligence'
        AND tc.table_name = 'contacts'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND tc.constraint_name = 'contacts_tenant_workspace_fk'
    `);
    expect(result.rows.length).toBeGreaterThanOrEqual(2);
    const cols = result.rows.map((r) => r.column_name).sort();
    expect(cols).toContain('tenant_id');
    expect(cols).toContain('workspace_id');
    expect(result.rows[0].foreign_table_schema).toBe('identity');
    expect(result.rows[0].foreign_table_name).toBe('workspaces');
  });

  // 7. Contact→Account composite ownership FK exists
  it('Contact→Account composite ownership FK exists', async () => {
    const result = await adminPool.query(`
      SELECT
        tc.constraint_name,
        kcu.column_name,
        ccu.table_schema AS foreign_table_schema,
        ccu.table_name AS foreign_table_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.table_schema = 'intelligence'
        AND tc.table_name = 'contacts'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND tc.constraint_name = 'contacts_account_ownership_fk'
    `);
    expect(result.rows.length).toBeGreaterThanOrEqual(3);
    const cols = result.rows.map((r) => r.column_name).sort();
    expect(cols).toContain('account_id');
    expect(cols).toContain('tenant_id');
    expect(cols).toContain('workspace_id');
    expect(result.rows[0].foreign_table_schema).toBe('intelligence');
    expect(result.rows[0].foreign_table_name).toBe('accounts');
  });

  // 8. Tenant A + Workspace owned by Tenant B rejected
  it('Tenant A + Workspace owned by Tenant B is rejected', async () => {
    await expect(
      adminPool.query(
        `INSERT INTO intelligence.contacts (contact_id, tenant_id, workspace_id, account_id, status, verification_state)
         VALUES ($1, $2, $3, $4, 'DISCOVERED', 'UNVERIFIED')`,
        ['contact-8b2b-fk1', TENANT_A, WS_B1, ACC_A1],
      ),
    ).rejects.toThrow(/foreign key constraint/);
  });

  // 9. Contact in Workspace A pointing to Account in Workspace B rejected
  it('Contact under Tenant A/Workspace A pointing at Account in Workspace B is rejected', async () => {
    await expect(
      adminPool.query(
        `INSERT INTO intelligence.contacts (contact_id, tenant_id, workspace_id, account_id, status, verification_state)
         VALUES ($1, $2, $3, $4, 'DISCOVERED', 'UNVERIFIED')`,
        ['contact-8b2b-fk2', TENANT_A, WS_A1, ACC_B1],
      ),
    ).rejects.toThrow(/foreign key constraint/);
  });

  // 10. Same email fingerprint + same tenant/workspace/account rejected
  it('same email fingerprint + same tenant/workspace/account is rejected', async () => {
    await adminPool.query(
      `INSERT INTO intelligence.contacts (contact_id, tenant_id, workspace_id, account_id, email_fingerprint, status, verification_state)
       VALUES ($1, $2, $3, $4, $5, 'DISCOVERED', 'UNVERIFIED')`,
      ['contact-8b2b-dup1', TENANT_A, WS_A1, ACC_A1, EMAIL_FP_1],
    );
    await expect(
      adminPool.query(
        `INSERT INTO intelligence.contacts (contact_id, tenant_id, workspace_id, account_id, email_fingerprint, status, verification_state)
         VALUES ($1, $2, $3, $4, $5, 'DISCOVERED', 'UNVERIFIED')`,
        ['contact-8b2b-dup2', TENANT_A, WS_A1, ACC_A1, EMAIL_FP_1],
      ),
    ).rejects.toThrow(/unique constraint/);
  });

  // 11. Same email fingerprint in different workspace allowed
  it('same email fingerprint in different workspace is allowed', async () => {
    await adminPool.query(
      `INSERT INTO intelligence.contacts (contact_id, tenant_id, workspace_id, account_id, email_fingerprint, status, verification_state)
       VALUES ($1, $2, $3, $4, $5, 'DISCOVERED', 'UNVERIFIED')`,
      ['contact-8b2b-ws1', TENANT_A, WS_A1, ACC_A1, EMAIL_FP_2],
    );
    await adminPool.query(
      `INSERT INTO intelligence.contacts (contact_id, tenant_id, workspace_id, account_id, email_fingerprint, status, verification_state)
       VALUES ($1, $2, $3, $4, $5, 'DISCOVERED', 'UNVERIFIED')`,
      ['contact-8b2b-ws2', TENANT_A, WS_A2, ACC_A2, EMAIL_FP_2],
    );
  });

  // 12. Same email fingerprint for different Account in same workspace allowed
  it('same email fingerprint for different Account in same workspace is allowed', async () => {
    await adminPool.query(
      `INSERT INTO intelligence.contacts (contact_id, tenant_id, workspace_id, account_id, email_fingerprint, status, verification_state)
       VALUES ($1, $2, $3, $4, $5, 'DISCOVERED', 'UNVERIFIED')`,
      ['contact-8b2b-acc1', TENANT_A, WS_A1, ACC_A1, EMAIL_FP_3],
    );
    await adminPool.query(
      `INSERT INTO intelligence.contacts (contact_id, tenant_id, workspace_id, account_id, email_fingerprint, status, verification_state)
       VALUES ($1, $2, $3, $4, $5, 'DISCOVERED', 'UNVERIFIED')`,
      ['contact-8b2b-acc2', TENANT_A, WS_A1, ACC_A1B, EMAIL_FP_3],
    );
  });

  // 13. Two NULL email fingerprints in same account/workspace allowed
  it('two NULL email fingerprints in same account/workspace are allowed', async () => {
    await adminPool.query(
      `INSERT INTO intelligence.contacts (contact_id, tenant_id, workspace_id, account_id, status, verification_state)
       VALUES ($1, $2, $3, $4, 'DISCOVERED', 'UNVERIFIED')`,
      ['contact-8b2b-null1', TENANT_A, WS_A1, ACC_A1],
    );
    await adminPool.query(
      `INSERT INTO intelligence.contacts (contact_id, tenant_id, workspace_id, account_id, status, verification_state)
       VALUES ($1, $2, $3, $4, 'DISCOVERED', 'UNVERIFIED')`,
      ['contact-8b2b-null2', TENANT_A, WS_A1, ACC_A1],
    );
  });

  // 14. Same phone fingerprint + same tenant/workspace/account rejected
  it('same phone fingerprint + same tenant/workspace/account is rejected', async () => {
    await adminPool.query(
      `INSERT INTO intelligence.contacts (contact_id, tenant_id, workspace_id, account_id, phone_fingerprint, status, verification_state)
       VALUES ($1, $2, $3, $4, $5, 'DISCOVERED', 'UNVERIFIED')`,
      ['contact-8b2b-phone1', TENANT_A, WS_A1, ACC_A1, PHONE_FP_1],
    );
    await expect(
      adminPool.query(
        `INSERT INTO intelligence.contacts (contact_id, tenant_id, workspace_id, account_id, phone_fingerprint, status, verification_state)
         VALUES ($1, $2, $3, $4, $5, 'DISCOVERED', 'UNVERIFIED')`,
        ['contact-8b2b-phone2', TENANT_A, WS_A1, ACC_A1, PHONE_FP_1],
      ),
    ).rejects.toThrow(/unique constraint/);
  });

  // 15. NULL phone fingerprints do not collide
  it('NULL phone fingerprints do not collide', async () => {
    await adminPool.query(
      `INSERT INTO intelligence.contacts (contact_id, tenant_id, workspace_id, account_id, status, verification_state)
       VALUES ($1, $2, $3, $4, 'DISCOVERED', 'UNVERIFIED')`,
      ['contact-8b2b-phone-null1', TENANT_A, WS_A1, ACC_A1],
    );
    await adminPool.query(
      `INSERT INTO intelligence.contacts (contact_id, tenant_id, workspace_id, account_id, status, verification_state)
       VALUES ($1, $2, $3, $4, 'DISCOVERED', 'UNVERIFIED')`,
      ['contact-8b2b-phone-null2', TENANT_A, WS_A1, ACC_A1],
    );
  });

  // 16. Ciphertext NOT used for uniqueness (independent proof)
  it('same encrypted_email with different email_fingerprint, same tenant/workspace/account must both succeed', async () => {
    await adminPool.query(
      `INSERT INTO intelligence.contacts (contact_id, tenant_id, workspace_id, account_id, email_fingerprint, encrypted_email, status, verification_state)
       VALUES ($1, $2, $3, $4, $5, $6, 'DISCOVERED', 'UNVERIFIED')`,
      ['contact-8b2b-cipher1', TENANT_A, WS_A1, ACC_A1, EMAIL_FP_4, CIPHER_1],
    );
    await adminPool.query(
      `INSERT INTO intelligence.contacts (contact_id, tenant_id, workspace_id, account_id, email_fingerprint, encrypted_email, status, verification_state)
       VALUES ($1, $2, $3, $4, $5, $6, 'DISCOVERED', 'UNVERIFIED')`,
      ['contact-8b2b-cipher2', TENANT_A, WS_A1, ACC_A1, PHONE_FP_1, CIPHER_1],
    );
  });

  // 17. Allowed enum values accepted
  it('allowed enum values are accepted', async () => {
    await adminPool.query(
      `INSERT INTO intelligence.contacts (contact_id, tenant_id, workspace_id, account_id, status, verification_state, consent_status)
       VALUES ($1, $2, $3, $4, 'DISCOVERED', 'UNVERIFIED', 'GRANTED')`,
      ['contact-8b2b-enum1', TENANT_A, WS_A1, ACC_A1],
    );
    await adminPool.query(
      `INSERT INTO intelligence.contacts (contact_id, tenant_id, workspace_id, account_id, status, verification_state, consent_status)
       VALUES ($1, $2, $3, $4, 'ENRICHED', 'VERIFIED', 'WITHHELD')`,
      ['contact-8b2b-enum2', TENANT_A, WS_A1, ACC_A1],
    );
    await adminPool.query(
      `INSERT INTO intelligence.contacts (contact_id, tenant_id, workspace_id, account_id, status, verification_state, consent_status)
       VALUES ($1, $2, $3, $4, 'VALIDATED', 'BOUNCED', 'UNKNOWN')`,
      ['contact-8b2b-enum3', TENANT_A, WS_A1, ACC_A1],
    );
  });

  // 18. Invalid enum value rejected
  it('invalid persisted enum value is rejected', async () => {
    await expect(
      adminPool.query(
        `INSERT INTO intelligence.contacts (contact_id, tenant_id, workspace_id, account_id, status, verification_state)
         VALUES ($1, $2, $3, $4, 'INVALID_STATUS', 'UNVERIFIED')`,
        ['contact-8b2b-bad-enum', TENANT_A, WS_A1, ACC_A1],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  // 19. RLS enabled
  it('RLS is enabled', async () => {
    const result = await adminPool.query(`
      SELECT relrowsecurity
      FROM pg_class
      JOIN pg_namespace ON pg_class.relnamespace = pg_namespace.oid
      WHERE pg_namespace.nspname = 'intelligence' AND pg_class.relname = 'contacts'
    `);
    expect(result.rows[0].relrowsecurity).toBe(true);
  });

  // 20. FORCE RLS enabled
  it('FORCE RLS is enabled', async () => {
    const result = await adminPool.query(`
      SELECT relforcerowsecurity
      FROM pg_class
      JOIN pg_namespace ON pg_class.relnamespace = pg_namespace.oid
      WHERE pg_namespace.nspname = 'intelligence' AND pg_class.relname = 'contacts'
    `);
    expect(result.rows[0].relforcerowsecurity).toBe(true);
  });

  // 21. projectx_app rolsuper=false
  it('projectx_app rolsuper is false', async () => {
    const result = await adminPool.query(`
      SELECT rolsuper
      FROM pg_roles
      WHERE rolname = 'projectx_app'
    `);
    expect(result.rows[0].rolsuper).toBe(false);
  });

  // 22. projectx_app rolbypassrls=false
  it('projectx_app rolbypassrls is false', async () => {
    const result = await adminPool.query(`
      SELECT rolbypassrls
      FROM pg_roles
      WHERE rolname = 'projectx_app'
    `);
    expect(result.rows[0].rolbypassrls).toBe(false);
  });

  // 23. Independent RLS probe cannot see another tenant's Contact
  it('independent projectx_app RLS probe cannot see another tenant Contact', async () => {
    // Insert a contact under Tenant A via admin
    await adminPool.query(
      `INSERT INTO intelligence.contacts (contact_id, tenant_id, workspace_id, account_id, name, status, verification_state)
       VALUES ($1, $2, $3, $4, 'Alice', 'DISCOVERED', 'UNVERIFIED')`,
      ['contact-8b2b-rls-a', TENANT_A, WS_A1, ACC_A1],
    );

    // Query under Tenant B context via app pool
    await appPool.query(`SET app.current_tenant = '${TENANT_B}'`);
    const result = await appPool.query(
      `SELECT * FROM intelligence.contacts WHERE contact_id = $1`,
      ['contact-8b2b-rls-a'],
    );
    expect(result.rows.length).toBe(0);
  });

  // 24. RLS write protection: INSERT with wrong tenant rejected
  it('projectx_app under Tenant A context cannot INSERT with Tenant B', async () => {
    await appPool.query(`SET app.current_tenant = '${TENANT_A}'`);
    await expect(
      appPool.query(
        `INSERT INTO intelligence.contacts (contact_id, tenant_id, workspace_id, account_id, name, status, verification_state)
         VALUES ($1, $2, $3, $4, 'Bob', 'DISCOVERED', 'UNVERIFIED')`,
        ['contact-8b2b-rls-write', TENANT_B, WS_B1, ACC_B1],
      ),
    ).rejects.toThrow();
  });

  // 25. contact_version column exists and is INTEGER NOT NULL
  it('contact_version column exists with correct type and NOT NULL', async () => {
    const result = await adminPool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'intelligence'
        AND table_name = 'contacts'
        AND column_name = 'contact_version'
    `);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].data_type).toBe('integer');
    expect(result.rows[0].is_nullable).toBe('NO');
  });

  // 26. contact_version CHECK constraint exists (version >= 1)
  it('contact_version CHECK constraint rejects invalid versions', async () => {
    await expect(
      adminPool.query(
        `INSERT INTO intelligence.contacts (contact_id, tenant_id, workspace_id, account_id, contact_version, status, verification_state)
         VALUES ($1, $2, $3, $4, 0, 'DISCOVERED', 'UNVERIFIED')`,
        ['contact-8b2c-version-0', TENANT_A, WS_A1, ACC_A1],
      ),
    ).rejects.toThrow(/check constraint/);

    await expect(
      adminPool.query(
        `INSERT INTO intelligence.contacts (contact_id, tenant_id, workspace_id, account_id, contact_version, status, verification_state)
         VALUES ($1, $2, $3, $4, -1, 'DISCOVERED', 'UNVERIFIED')`,
        ['contact-8b2c-version-neg', TENANT_A, WS_A1, ACC_A1],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  // 27. valid initial aggregate version (1) is accepted
  it('contact_version = 1 (initial aggregate version) is accepted', async () => {
    await adminPool.query(
      `INSERT INTO intelligence.contacts (contact_id, tenant_id, workspace_id, account_id, contact_version, status, verification_state)
       VALUES ($1, $2, $3, $4, 1, 'DISCOVERED', 'UNVERIFIED')`,
      ['contact-8b2c-version-1', TENANT_A, WS_A1, ACC_A1],
    );
  });

  // 28. default backfill for existing rows is 1
  it('INSERT without explicit contact_version uses default 1', async () => {
    await adminPool.query(
      `INSERT INTO intelligence.contacts (contact_id, tenant_id, workspace_id, account_id, status, verification_state)
       VALUES ($1, $2, $3, $4, 'DISCOVERED', 'UNVERIFIED')`,
      ['contact-8b2c-version-default', TENANT_A, WS_A1, ACC_A1],
    );

    const result = await adminPool.query(
      `SELECT contact_version FROM intelligence.contacts WHERE contact_id = $1`,
      ['contact-8b2c-version-default'],
    );
    expect(result.rows[0].contact_version).toBe(1);
  });

  // 29. Existing 8B2b constraints remain intact after concurrency migration
  it('email fingerprint dedup index still exists after migration', async () => {
    const result = await adminPool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'intelligence'
        AND tablename = 'contacts'
        AND indexname = 'contacts_workspace_account_email_fingerprint_dedup'
    `);
    expect(result.rows.length).toBe(1);
  });

  it('phone fingerprint dedup index still exists after migration', async () => {
    const result = await adminPool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'intelligence'
        AND tablename = 'contacts'
        AND indexname = 'contacts_workspace_account_phone_fingerprint_dedup'
    `);
    expect(result.rows.length).toBe(1);
  });

  it('workspace ownership FK still exists after migration', async () => {
    const result = await adminPool.query(`
      SELECT tc.constraint_name
      FROM information_schema.table_constraints AS tc
      WHERE tc.table_schema = 'intelligence'
        AND tc.table_name = 'contacts'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND tc.constraint_name = 'contacts_tenant_workspace_fk'
    `);
    expect(result.rows.length).toBe(1);
  });

  it('account ownership FK still exists after migration', async () => {
    const result = await adminPool.query(`
      SELECT tc.constraint_name
      FROM information_schema.table_constraints AS tc
      WHERE tc.table_schema = 'intelligence'
        AND tc.table_name = 'contacts'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND tc.constraint_name = 'contacts_account_ownership_fk'
    `);
    expect(result.rows.length).toBe(1);
  });

  it('RLS still enabled after migration', async () => {
    const result = await adminPool.query(`
      SELECT relrowsecurity
      FROM pg_class
      JOIN pg_namespace ON pg_class.relnamespace = pg_namespace.oid
      WHERE pg_namespace.nspname = 'intelligence' AND pg_class.relname = 'contacts'
    `);
    expect(result.rows[0].relrowsecurity).toBe(true);
  });
});
