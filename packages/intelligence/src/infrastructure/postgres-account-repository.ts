import type { Pool, PoolClient } from 'pg';
import { Account, TenantIsolationError, AuthorizationError } from '@projectx/domain';
import { asAccountId, asTenantId, asEvidenceId } from '@projectx/shared';
import type { AccountRepositoryContext, IAccountRepository } from '@projectx/infrastructure';
import { PostgresClient, ConcurrencyConflictError, DuplicateRecordError, toRequiredDate } from '@projectx/infrastructure';

/**
 * Safe NUMERIC rehydration for values that round-trip through PostgreSQL
 * NUMERIC columns (which the pg driver returns as strings). Follows the same
 * explicit, field-scoped pattern as toDate/toRequiredDate in date-utils.
 */
function toOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Cannot rehydrate non-finite numeric value: ${JSON.stringify(value)}`);
  }
  if (Math.abs(n) > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Numeric value exceeds safe integer magnitude: ${JSON.stringify(value)}`);
  }
  return n;
}

/** Maps a PostgreSQL row to the props consumed by Account.reconstitute(). */
function rowToAccount(row: Record<string, unknown>): Account {
  const account = Account.reconstitute(
    {
      id: asAccountId(row.account_id as string),
      tenantId: asTenantId(row.tenant_id as string),
      workspaceId: row.workspace_id as string,
      name: row.name as string,
      domain: row.domain as string | undefined,
      normalizedDomain: row.normalized_domain as string | undefined,
      aliases: row.aliases as string[] ?? [],
      industry: row.industry as string | undefined,
      geography: row.geography as string | undefined,
      companySizeBand: row.company_size_band as any,
      employeeCount: toOptionalNumber(row.employee_count),
      annualRevenueUsd: toOptionalNumber(row.annual_revenue_usd),
      territories: row.territories as string[] ?? [],
      techStack: row.tech_stack as string[] ?? [],
      enrichmentState: row.enrichment_state as any,
      status: row.status as any,
      duplicateOf: row.duplicate_of ? asAccountId(row.duplicate_of as string) : undefined,
      evidenceReferences: ((row.evidence_references as string[]) ?? []).map(asEvidenceId),
      accountVersion: row.account_version as number,
      createdAt: toRequiredDate(row.created_at as string | Date),
      updatedAt: toRequiredDate(row.updated_at as string | Date),
    },
    row.account_version as number,
  );
  return account;
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
    if (pgErr.constraint === 'accounts_pkey') {
      return new ConcurrencyConflictError(
        `Account ${aggregateId} already exists`,
        tenantId,
        aggregateId,
        undefined,
      );
    }
    if (pgErr.constraint === 'accounts_workspace_domain_dedup') {
      return new DuplicateRecordError(
        `Duplicate normalized domain in workspace for account ${aggregateId}`,
        tenantId,
        aggregateId,
        'normalized_domain',
      );
    }
    return new ConcurrencyConflictError(
      `Unique constraint violation for account ${aggregateId}`,
      tenantId,
      aggregateId,
      undefined,
    );
  }
  return new Error(`Persistence failure for account ${aggregateId}`);
}

const FIND_BY_ID_SQL = `
  SELECT * FROM intelligence.accounts
  WHERE tenant_id = $1 AND workspace_id = $2 AND account_id = $3
  LIMIT 1
`;

const FIND_QUALIFIED_SQL = `
  SELECT * FROM intelligence.accounts
  WHERE tenant_id = $1 AND workspace_id = $2 AND status = 'QUALIFIED'
`;

const INSERT_SQL = `
  INSERT INTO intelligence.accounts (
    account_id, tenant_id, workspace_id, name, domain, normalized_domain,
    aliases, industry, geography, company_size_band, employee_count,
    annual_revenue_usd, territories, tech_stack, enrichment_state, status,
    duplicate_of, evidence_references, account_version, created_at, updated_at
  ) VALUES (
    $1, $2, $3, $4, $5, $6,
    $7, $8, $9, $10, $11,
    $12, $13, $14, $15, $16,
    $17, $18, $19, $20, $21
  )
`;

const UPDATE_SQL = `
  UPDATE intelligence.accounts SET
    name = $5,
    domain = $6,
    normalized_domain = $7,
    aliases = $8,
    industry = $9,
    geography = $10,
    company_size_band = $11,
    employee_count = $12,
    annual_revenue_usd = $13,
    territories = $14,
    tech_stack = $15,
    enrichment_state = $16,
    status = $17,
    duplicate_of = $18,
    evidence_references = $19,
    account_version = $20,
    updated_at = $21
  WHERE tenant_id = $1
    AND workspace_id = $2
    AND account_id = $3
    AND account_version = $4
`;

export class PostgresAccountRepository implements IAccountRepository {
  private readonly client: PostgresClient;

  constructor(pool: Pool) {
    this.client = new PostgresClient(pool);
  }

  async findById(ctx: AccountRepositoryContext, id: string): Promise<Account | null> {
    return this.client.withTenant(ctx, async (client: PoolClient) => {
      const result = await client.query(FIND_BY_ID_SQL, [
        ctx.tenantId,
        ctx.workspaceId,
        id,
      ]);
      if (result.rows.length === 0) return null;
      return rowToAccount(result.rows[0]);
    });
  }

  async save(ctx: AccountRepositoryContext, account: Account): Promise<void> {
    if (ctx.tenantId !== account.tenantId) {
      throw new TenantIsolationError(
        `Account tenant ${account.tenantId} does not match context tenant ${ctx.tenantId}`,
      );
    }
    if (ctx.workspaceId !== account.workspaceId) {
      throw new AuthorizationError(
        `Account workspace ${account.workspaceId} does not match authorized workspace ${ctx.workspaceId}`,
      );
    }

    const isNew = account.loadedVersion === undefined;

    await this.client.withTenant(ctx, async (client: PoolClient) => {
      if (isNew) {
        await this.insert(client, ctx, account);
      } else {
        await this.update(client, ctx, account);
      }
    });

    account.setVersion(account.accountVersion);
  }

  async findQualified(ctx: AccountRepositoryContext): Promise<Account[]> {
    return this.client.withTenant(ctx, async (client: PoolClient) => {
      const result = await client.query(FIND_QUALIFIED_SQL, [
        ctx.tenantId,
        ctx.workspaceId,
      ]);
      return result.rows.map(rowToAccount);
    });
  }

  private async insert(
    client: PoolClient,
    ctx: AccountRepositoryContext,
    account: Account,
  ): Promise<void> {
    try {
      await client.query(INSERT_SQL, [
        account.id,                                    // $1  account_id
        ctx.tenantId,                                  // $2  tenant_id
        ctx.workspaceId,                               // $3  workspace_id
        account.name,                                  // $4  name
        account.domain ?? null,                        // $5  domain
        account.normalizedDomain ?? null,              // $6  normalized_domain
        JSON.stringify(account.aliases),               // $7  aliases
        account.industry ?? null,                      // $8  industry
        account.geography ?? null,                     // $9  geography
        account.companySizeBand ?? null,               // $10 company_size_band
        account.employeeCount ?? null,                 // $11 employee_count
        account.annualRevenueUsd ?? null,              // $12 annual_revenue_usd
        JSON.stringify(account.territories),           // $13 territories
        JSON.stringify(account.techStack),             // $14 tech_stack
        account.enrichmentState,                       // $15 enrichment_state
        account.status,                                // $16 status
        account.duplicateOf ?? null,                   // $17 duplicate_of
        JSON.stringify(account.evidenceReferences),    // $18 evidence_references
        account.accountVersion,                        // $19 account_version
        account.createdAt,                             // $20 created_at
        account.updatedAt,                             // $21 updated_at
      ]);
    } catch (err) {
      throw classifyPgError(err, ctx.tenantId as string, account.id as string);
    }
  }

  private async update(
    client: PoolClient,
    ctx: AccountRepositoryContext,
    account: Account,
  ): Promise<void> {
    const expectedVersion = account.loadedVersion!;
    let result;
    try {
      result = await client.query(UPDATE_SQL, [
        ctx.tenantId,                                  // $1  WHERE tenant_id
        ctx.workspaceId,                               // $2  WHERE workspace_id
        account.id,                                    // $3  WHERE account_id
        expectedVersion,                               // $4  WHERE account_version
        account.name,                                  // $5  SET name
        account.domain ?? null,                        // $6  SET domain
        account.normalizedDomain ?? null,              // $7  SET normalized_domain
        JSON.stringify(account.aliases),               // $8  SET aliases
        account.industry ?? null,                      // $9  SET industry
        account.geography ?? null,                     // $10 SET geography
        account.companySizeBand ?? null,               // $11 SET company_size_band
        account.employeeCount ?? null,                 // $12 SET employee_count
        account.annualRevenueUsd ?? null,              // $13 SET annual_revenue_usd
        JSON.stringify(account.territories),           // $14 SET territories
        JSON.stringify(account.techStack),             // $15 SET tech_stack
        account.enrichmentState,                       // $16 SET enrichment_state
        account.status,                                // $17 SET status
        account.duplicateOf ?? null,                   // $18 SET duplicate_of
        JSON.stringify(account.evidenceReferences),    // $19 SET evidence_references
        account.accountVersion,                        // $20 SET account_version
        account.updatedAt,                             // $21 SET updated_at
      ]);
    } catch (err) {
      throw classifyPgError(err, ctx.tenantId as string, account.id as string);
    }
    if (result.rowCount === 0) {
      throw new ConcurrencyConflictError(
        `Stale version for account ${account.id}: expected ${expectedVersion}`,
        ctx.tenantId as string,
        account.id as string,
        expectedVersion,
      );
    }
  }
}
