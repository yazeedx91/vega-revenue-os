import type { Pool, PoolClient } from 'pg';
import { Contact, TenantIsolationError, AuthorizationError } from '@projectx/domain';
import { asContactId, asAccountId, asEvidenceId, asTenantId } from '@projectx/shared';
import type { ContactRepositoryContext, IContactRepository } from '@projectx/infrastructure';
import { PostgresClient, ConcurrencyConflictError, DuplicateRecordError, toRequiredDate } from '@projectx/infrastructure';

/** Maps a PostgreSQL row to the props consumed by Contact.reconstitute(). */
function rowToContact(row: Record<string, unknown>): Contact {
  const contact = Contact.reconstitute(
    {
      id: asContactId(row.contact_id as string),
      tenantId: asTenantId(row.tenant_id as string),
      workspaceId: row.workspace_id as string,
      accountId: asAccountId(row.account_id as string),
      name: row.name as string | undefined,
      title: row.title as string | undefined,
      role: row.role as string | undefined,
      seniority: row.seniority as string | undefined,
      department: row.department as string | undefined,
      functionRole: row.function_role as string | undefined,
      emailFingerprint: row.email_fingerprint as string | undefined,
      encryptedEmail: row.encrypted_email as string | undefined,
      phoneFingerprint: row.phone_fingerprint as string | undefined,
      encryptedPhone: row.encrypted_phone as string | undefined,
      linkedInUrl: row.linked_in_url as string | undefined,
      channels: ((row.channels as string[]) ?? []),
      consentStatus: row.consent_status as any,
      verificationState: row.verification_state as any,
      status: row.status as any,
      suppressionReason: row.suppression_reason as string | undefined,
      suppressionReference: row.suppression_reference as string | undefined,
      suppressedAt: row.suppressed_at ? toRequiredDate(row.suppressed_at as string | Date) : undefined,
      evidenceReferences: ((row.evidence_references as string[]) ?? []).map(asEvidenceId),
      createdAt: toRequiredDate(row.created_at as string | Date),
      updatedAt: toRequiredDate(row.updated_at as string | Date),
    },
    row.contact_version as number,
  );
  return contact;
}

/**
 * Classifies a PostgreSQL error into the appropriate domain error. Never
 * exposes raw SQL, connection info, or query parameter values upstream.
 */
function classifyPgError(
  err: unknown,
  tenantId: string,
  aggregateId: string,
): Error {
  const pgErr = err as { code?: string; constraint?: string };
  if (pgErr.code === '23505') {
    if (pgErr.constraint === 'contacts_pkey') {
      return new ConcurrencyConflictError(
        `Contact ${aggregateId} already exists`,
        tenantId,
        aggregateId,
        undefined,
      );
    }
    if (pgErr.constraint === 'contacts_workspace_account_email_fingerprint_dedup') {
      return new DuplicateRecordError(
        `Duplicate email fingerprint for contact ${aggregateId}`,
        tenantId,
        aggregateId,
        'email_fingerprint',
      );
    }
    if (pgErr.constraint === 'contacts_workspace_account_phone_fingerprint_dedup') {
      return new DuplicateRecordError(
        `Duplicate phone fingerprint for contact ${aggregateId}`,
        tenantId,
        aggregateId,
        'phone_fingerprint',
      );
    }
    return new ConcurrencyConflictError(
      `Unique constraint violation for contact ${aggregateId}`,
      tenantId,
      aggregateId,
      undefined,
    );
  }
  return new Error(`Persistence failure for contact ${aggregateId}`);
}

const FIND_BY_ID_SQL = `
  SELECT * FROM intelligence.contacts
  WHERE tenant_id = $1 AND workspace_id = $2 AND contact_id = $3
  LIMIT 1
`;

const FIND_BY_ACCOUNT_SQL = `
  SELECT * FROM intelligence.contacts
  WHERE tenant_id = $1 AND workspace_id = $2 AND account_id = $3
`;

const INSERT_SQL = `
  INSERT INTO intelligence.contacts (
    contact_id, tenant_id, workspace_id, account_id, name, title, role,
    seniority, department, function_role, email_fingerprint, encrypted_email,
    phone_fingerprint, encrypted_phone, linked_in_url, channels, consent_status,
    verification_state, status, suppression_reason, suppression_reference,
    suppressed_at, evidence_references, contact_version, created_at, updated_at
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7,
    $8, $9, $10, $11, $12,
    $13, $14, $15, $16, $17,
    $18, $19, $20, $21,
    $22, $23, $24, $25, $26
  )
`;

const UPDATE_SQL = `
  UPDATE intelligence.contacts SET
    name = $5,
    title = $6,
    role = $7,
    seniority = $8,
    department = $9,
    function_role = $10,
    email_fingerprint = $11,
    encrypted_email = $12,
    phone_fingerprint = $13,
    encrypted_phone = $14,
    linked_in_url = $15,
    channels = $16,
    consent_status = $17,
    verification_state = $18,
    status = $19,
    suppression_reason = $20,
    suppression_reference = $21,
    suppressed_at = $22,
    evidence_references = $23,
    contact_version = $24,
    updated_at = $25
  WHERE tenant_id = $1
    AND workspace_id = $2
    AND contact_id = $3
    AND contact_version = $4
`;

export class PostgresContactRepository implements IContactRepository {
  private readonly client: PostgresClient;

  constructor(pool: Pool) {
    this.client = new PostgresClient(pool);
  }

  async findById(ctx: ContactRepositoryContext, id: string): Promise<Contact | null> {
    return this.client.withTenant(ctx, async (client: PoolClient) => {
      const result = await client.query(FIND_BY_ID_SQL, [
        ctx.tenantId,
        ctx.workspaceId,
        id,
      ]);
      if (result.rows.length === 0) return null;
      return rowToContact(result.rows[0]);
    });
  }

  async save(ctx: ContactRepositoryContext, contact: Contact): Promise<void> {
    if (ctx.tenantId !== contact.tenantId) {
      throw new TenantIsolationError(
        `Contact tenant ${contact.tenantId} does not match context tenant ${ctx.tenantId}`,
      );
    }
    if (ctx.workspaceId !== contact.workspaceId) {
      throw new AuthorizationError(
        `Contact workspace ${contact.workspaceId} does not match authorized workspace ${ctx.workspaceId}`,
      );
    }

    const isNew = contact.loadedVersion === undefined;

    await this.client.withTenant(ctx, async (client: PoolClient) => {
      if (isNew) {
        await this.insert(client, ctx, contact);
      } else {
        await this.update(client, ctx, contact);
      }
    });

    contact.setVersion(contact.version);
  }

  async findByAccount(ctx: ContactRepositoryContext, accountId: string): Promise<Contact[]> {
    return this.client.withTenant(ctx, async (client: PoolClient) => {
      const result = await client.query(FIND_BY_ACCOUNT_SQL, [
        ctx.tenantId,
        ctx.workspaceId,
        accountId,
      ]);
      return result.rows.map(rowToContact);
    });
  }

  private async insert(
    client: PoolClient,
    ctx: ContactRepositoryContext,
    contact: Contact,
  ): Promise<void> {
    try {
      await client.query(INSERT_SQL, [
        contact.id,                                     // $1  contact_id
        ctx.tenantId,                                   // $2  tenant_id
        ctx.workspaceId,                                // $3  workspace_id
        contact.accountId,                              // $4  account_id
        contact.name ?? null,                           // $5  name
        contact.title ?? null,                          // $6  title
        contact.role ?? null,                           // $7  role
        contact.seniority ?? null,                      // $8  seniority
        contact.department ?? null,                     // $9  department
        contact.functionRole ?? null,                   // $10 function_role
        contact.emailFingerprint ?? null,               // $11 email_fingerprint
        contact.encryptedEmail ?? null,                 // $12 encrypted_email
        contact.phoneFingerprint ?? null,               // $13 phone_fingerprint
        contact.encryptedPhone ?? null,                 // $14 encrypted_phone
        contact.linkedInUrl ?? null,                    // $15 linked_in_url
        JSON.stringify(contact.channels),              // $16 channels
        contact.consentStatus ?? null,                  // $17 consent_status
        contact.verificationState,                      // $18 verification_state
        contact.status,                                 // $19 status
        contact.suppressionReason ?? null,              // $20 suppression_reason
        contact.suppressionReference ?? null,           // $21 suppression_reference
        contact.suppressedAt ?? null,                    // $22 suppressed_at
        JSON.stringify(contact.evidenceReferences),      // $23 evidence_references
        contact.version,                                 // $24 contact_version
        contact.createdAt,                               // $25 created_at
        contact.updatedAt,                               // $26 updated_at
      ]);
    } catch (err) {
      throw classifyPgError(err, ctx.tenantId as string, contact.id as string);
    }
  }

  private async update(
    client: PoolClient,
    ctx: ContactRepositoryContext,
    contact: Contact,
  ): Promise<void> {
    const expectedVersion = contact.loadedVersion!;
    let result;
    try {
      result = await client.query(UPDATE_SQL, [
        ctx.tenantId,                                   // $1  WHERE tenant_id
        ctx.workspaceId,                                // $2  WHERE workspace_id
        contact.id,                                     // $3  WHERE contact_id
        expectedVersion,                                // $4  WHERE contact_version
        contact.name ?? null,                           // $5  SET name
        contact.title ?? null,                          // $6  SET title
        contact.role ?? null,                           // $7  SET role
        contact.seniority ?? null,                      // $8  SET seniority
        contact.department ?? null,                     // $9  SET department
        contact.functionRole ?? null,                   // $10 SET function_role
        contact.emailFingerprint ?? null,               // $11 SET email_fingerprint
        contact.encryptedEmail ?? null,                 // $12 SET encrypted_email
        contact.phoneFingerprint ?? null,               // $13 SET phone_fingerprint
        contact.encryptedPhone ?? null,                 // $14 SET encrypted_phone
        contact.linkedInUrl ?? null,                    // $15 SET linked_in_url
        JSON.stringify(contact.channels),              // $16 SET channels
        contact.consentStatus ?? null,                  // $17 SET consent_status
        contact.verificationState,                      // $18 SET verification_state
        contact.status,                                 // $19 SET status
        contact.suppressionReason ?? null,              // $20 SET suppression_reason
        contact.suppressionReference ?? null,           // $21 SET suppression_reference
        contact.suppressedAt ?? null,                    // $22 SET suppressed_at
        JSON.stringify(contact.evidenceReferences),      // $23 SET evidence_references
        contact.version,                                 // $24 SET contact_version
        contact.updatedAt,                               // $25 SET updated_at
      ]);
    } catch (err) {
      throw classifyPgError(err, ctx.tenantId as string, contact.id as string);
    }
    if (result.rowCount === 0) {
      throw new ConcurrencyConflictError(
        `Stale version for contact ${contact.id}: expected ${expectedVersion}`,
        ctx.tenantId as string,
        contact.id as string,
        expectedVersion,
      );
    }
  }
}
