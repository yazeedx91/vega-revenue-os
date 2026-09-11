/**
 * In-memory `pg.Pool`/`PoolClient` test double tailored to the exact query
 * shapes used by PostgresClient / PostgresRepository / PostgresIdempotencyStore
 * / PostgresAuditLog in this codebase. This is not a general SQL engine —
 * it recognizes a small, fixed set of statement patterns deterministically.
 *
 * No live PostgreSQL instance is required to exercise repository logic
 * (concurrency branching, tenant scoping, parameterization) with this double.
 */

export interface FakeQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

interface StoredRow {
  [key: string]: unknown;
  tenant_id: string;
  id: string;
  payload: unknown;
  version: number;
  updated_at: Date;
}

export interface RecordedQuery {
  sql: string;
  params: unknown[];
}

/**
 * Minimal stand-in for a `pg.PoolClient`.
 */
export class FakePoolClient {
  constructor(private readonly pool: FakePgPool) {}

  async query(sql: string, params: unknown[] = []): Promise<FakeQueryResult> {
    return this.pool.executeQuery(sql, params);
  }

  release(): void {
    // no-op; pool tracks state directly
  }
}

/**
 * Tables that are plain flat rows (no aggregate id/payload/version shape) —
 * e.g. safety-boundary policy tables like recipient allowlists and
 * suppression records. Keyed by (tenant_id, <naturalKeyColumn>).
 */
const FLAT_TABLES: Record<string, string> = {
  'outreach.allowed_recipients': 'email_address',
  'outreach.suppression': 'email_address',
  'outreach.tenant_email_config': 'provider_id',
  'outreach.graph_subscriptions': 'subscription_id',
};

interface IdempotencyRow {
  status: string;
  result: unknown;
  created_at: Date;
  expires_at: Date;
}

export class FakePgPool {
  readonly recordedQueries: RecordedQuery[] = [];
  private readonly tables = new Map<string, Map<string, StoredRow>>();
  private readonly flatTables = new Map<string, Map<string, Record<string, unknown>>>();
  private readonly idempotencyKeys = new Map<string, IdempotencyRow>();
  private currentTenant: string | undefined;

  /** Seed a row directly, bypassing INSERT — useful for reconstitution tests. */
  seedRow(tableName: string, row: StoredRow): void {
    this.tableFor(tableName).set(this.rowKey(row.tenant_id, row.id), { ...row });
  }

  getRow(tableName: string, tenantId: string, id: string): StoredRow | undefined {
    return this.tableFor(tableName).get(this.rowKey(tenantId, id));
  }

  async connect(): Promise<FakePoolClient> {
    return new FakePoolClient(this);
  }

  async query(sql: string, params: unknown[] = []): Promise<FakeQueryResult> {
    return this.executeQuery(sql, params);
  }

  executeQuery(sql: string, params: unknown[]): FakeQueryResult {
    this.recordedQueries.push({ sql, params });
    const normalized = sql.trim();

    if (/^BEGIN$/i.test(normalized) || /^COMMIT$/i.test(normalized) || /^ROLLBACK$/i.test(normalized)) {
      return { rows: [], rowCount: 0 };
    }

    if (normalized.includes("set_config('app.current_tenant'")) {
      this.currentTenant = params[0] as string;
      return { rows: [{ set_config: this.currentTenant }], rowCount: 1 };
    }

    const tableMatch = normalized.match(/FROM\s+([a-zA-Z0-9_.]+)/i) ?? normalized.match(/INTO\s+([a-zA-Z0-9_.]+)/i) ?? normalized.match(/UPDATE\s+([a-zA-Z0-9_.]+)/i) ?? normalized.match(/DELETE\s+FROM\s+([a-zA-Z0-9_.]+)/i);
    const tableName = tableMatch?.[1];

    if (tableName === 'idempotency.keys') {
      return this.executeIdempotencyQuery(normalized, params);
    }

    if (tableName && FLAT_TABLES[tableName]) {
      return this.executeFlatQuery(normalized, tableName, params);
    }

    if (/^SELECT/i.test(normalized) && tableName && normalized.includes('WHERE')) {
      return this.executeSelect(normalized, tableName, params);
    }

    if (/^INSERT/i.test(normalized) && tableName) {
      const columnsMatch = normalized.match(/\(([^)]+)\)\s*VALUES/i);
      const columns = columnsMatch?.[1].split(',').map((column) => column.trim());
      if (columns?.includes('workspace_id')) {
        const values: Record<string, unknown> = {};
        columns.forEach((column, index) => { values[column] = params[index]; });
        const tenantId = values.tenant_id as string;
        const id = values.id as string;
        const key = this.rowKey(tenantId, id);
        const table = this.tableFor(tableName);
        if (table.has(key)) return { rows: [], rowCount: 0 };
        table.set(key, {
          ...values,
          tenant_id: tenantId,
          id,
          payload: JSON.parse(values.payload as string),
          version: values.version as number,
          updated_at: new Date(),
        });
        return { rows: [{ id }], rowCount: 1 };
      }
      const [tenantId, id, payload, version] = params as [string, string, string, number];
      const key = this.rowKey(tenantId, id);
      const table = this.tableFor(tableName);
      if (table.has(key)) return { rows: [], rowCount: 0 };
      table.set(key, { tenant_id: tenantId, id, payload: JSON.parse(payload), version, updated_at: new Date() });
      return { rows: [{ id }], rowCount: 1 };
    }

    if (/^UPDATE/i.test(normalized) && tableName && normalized.includes('workspace_id')) {
      const tenantId = params[0] as string;
      const workspaceId = params[1] as string;
      const id = params[2] as string;
      const table = this.tableFor(tableName);
      const key = this.rowKey(tenantId, id);
      const existing = table.get(key);
      const expectedVersion = params[params.length - 1] as number;
      if (!existing || existing.workspace_id !== workspaceId || existing.version !== expectedVersion) return { rows: [], rowCount: 0 };
      const assignments = normalized.match(/SET\s+([\s\S]+?)\s+WHERE/i)?.[1].split(',') ?? [];
      const updated = { ...existing };
      for (const assignment of assignments) {
        const match = assignment.trim().match(/^(\w+)\s*=\s*\$(\d+)/);
        if (match) updated[match[1]] = params[Number(match[2]) - 1];
      }
      if (typeof updated.payload === 'string') updated.payload = JSON.parse(updated.payload);
      table.set(key, updated);
      return { rows: [{ id }], rowCount: 1 };
    }

    if (/^UPDATE/i.test(normalized) && tableName) {
      const [tenantId, id, payload, newVersion, expectedVersion] = params as [string, string, string, number, number];
      const key = this.rowKey(tenantId, id);
      const table = this.tableFor(tableName);
      const existing = table.get(key);
      if (!existing || existing.version !== expectedVersion) {
        return { rows: [], rowCount: 0 };
      }
      table.set(key, { tenant_id: tenantId, id, payload: JSON.parse(payload), version: newVersion, updated_at: new Date() });
      return { rows: [{ id }], rowCount: 1 };
    }

    throw new Error(`FakePgPool: unrecognized query shape: ${normalized}`);
  }

  private idempotencyKey(tenantId: string, scope: string, key: string): string {
    return `${tenantId}::${scope}::${key}`;
  }

  private executeIdempotencyQuery(normalizedSql: string, params: unknown[]): FakeQueryResult {
    if (/^SELECT/i.test(normalizedSql)) {
      const [tenantId, scope, key] = params as [string, string, string];
      const row = this.idempotencyKeys.get(this.idempotencyKey(tenantId, scope, key));
      if (!row || row.expires_at <= new Date()) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [{ status: row.status, result: row.result, created_at: row.created_at }], rowCount: 1 };
    }

    if (/^INSERT/i.test(normalizedSql)) {
      const hasConditionalGuard = /WHERE\s+idempotency\.keys\./i.test(normalizedSql);
      const hasReturning = /RETURNING/i.test(normalizedSql);

      // claim(): (tenantId, scope, key, resultJson, expiresAt) — status is a literal 'PENDING' in SQL, not a param.
      // set(): (tenantId, scope, key, status, resultJson, expiresAt).
      const tenantId = params[0] as string;
      const scope = params[1] as string;
      const key = params[2] as string;
      const status = hasConditionalGuard ? 'PENDING' : (params[3] as string);
      const resultJson = hasConditionalGuard ? (params[3] as string) : (params[4] as string);
      const expiresAt = hasConditionalGuard ? (params[4] as Date) : (params[5] as Date);

      const k = this.idempotencyKey(tenantId, scope, key);
      const existing = this.idempotencyKeys.get(k);

      if (!existing) {
        const row: IdempotencyRow = { status, result: JSON.parse(resultJson), created_at: new Date(), expires_at: expiresAt };
        this.idempotencyKeys.set(k, row);
        return hasReturning ? { rows: [{ status: row.status, result: row.result, created_at: row.created_at }], rowCount: 1 } : { rows: [], rowCount: 1 };
      }

      if (hasConditionalGuard) {
        // claim() semantics: PENDING records must never be reclaimed, because
        // the provider may have already accepted the submission. FAILED records
        // are only reclaimable when they provably never reached the provider.
        if (existing.status === 'PENDING') {
          return { rows: [], rowCount: 0 };
        }
        if (existing.status === 'FAILED') {
          const submitted = (existing.result as Record<string, unknown> | undefined)?.submitted;
          if (submitted !== false) {
            return { rows: [], rowCount: 0 };
          }
          // submitted === false: safe to reclaim; fall through to overwrite below.
        } else if (existing.status === 'COMPLETED') {
          return { rows: [], rowCount: 0 };
        }
      }

      const row: IdempotencyRow = { status, result: JSON.parse(resultJson), created_at: new Date(), expires_at: expiresAt };
      this.idempotencyKeys.set(k, row);
      return hasReturning ? { rows: [{ status: row.status, result: row.result, created_at: row.created_at }], rowCount: 1 } : { rows: [], rowCount: 1 };
    }

    throw new Error(`FakePgPool: unrecognized idempotency.keys query shape: ${normalizedSql}`);
  }

  private executeFlatQuery(normalizedSql: string, tableName: string, params: unknown[]): FakeQueryResult {
    const table = this.flatTableFor(tableName);

    if (/^INSERT/i.test(normalizedSql)) {
      const columnsMatch = normalizedSql.match(/\(([^)]+)\)\s*VALUES/i);
      if (!columnsMatch) {
        throw new Error(`FakePgPool: cannot parse INSERT columns for ${tableName}`);
      }
      const columns = columnsMatch[1].split(',').map((c) => c.trim());
      const row: Record<string, unknown> = {};
      columns.forEach((col, idx) => {
        row[col] = params[idx];
      });
      const naturalKeyCol = FLAT_TABLES[tableName];
      const key = this.rowKey(row.tenant_id as string, row[naturalKeyCol] as string);
      const existing = table.get(key);
      if (existing && !/ON CONFLICT/i.test(normalizedSql)) {
        return { rows: [], rowCount: 0 };
      }
      table.set(key, { ...existing, ...row });
      return { rows: [{ ...row }], rowCount: 1 };
    }

    if (/^DELETE/i.test(normalizedSql)) {
      const conditions = this.parseConditions(normalizedSql);
      let deleted = 0;
      for (const [key, row] of [...table.entries()]) {
        if (this.matchesFlatConditions(row, conditions, params)) {
          table.delete(key);
          deleted += 1;
        }
      }
      return { rows: [], rowCount: deleted };
    }

    if (/^SELECT/i.test(normalizedSql)) {
      const conditions = this.parseConditions(normalizedSql);
      const matches = [...table.values()].filter((row) => this.matchesFlatConditions(row, conditions, params));
      const limited = /LIMIT\s+1/i.test(normalizedSql) ? matches.slice(0, 1) : matches;
      return { rows: limited.map((r) => ({ ...r })), rowCount: limited.length };
    }

    throw new Error(`FakePgPool: unrecognized flat-table query shape: ${normalizedSql}`);
  }

  private parseConditions(normalizedSql: string): Array<{ column: string; paramIndex: number }> {
    const conditions: Array<{ column: string; paramIndex: number }> = [];
    const conditionRegex = /(\w+)\s*=\s*\$(\d+)/g;
    let match: RegExpExecArray | null;
    while ((match = conditionRegex.exec(normalizedSql)) !== null) {
      conditions.push({ column: match[1], paramIndex: Number(match[2]) - 1 });
    }
    return conditions;
  }

  private matchesFlatConditions(
    row: Record<string, unknown>,
    conditions: Array<{ column: string; paramIndex: number }>,
    params: unknown[],
  ): boolean {
    return conditions.every(({ column, paramIndex }) => row[column] === params[paramIndex]);
  }

  private flatTableFor(tableName: string): Map<string, Record<string, unknown>> {
    let table = this.flatTables.get(tableName);
    if (!table) {
      table = new Map();
      this.flatTables.set(tableName, table);
    }
    return table;
  }

  private executeSelect(normalizedSql: string, tableName: string, params: unknown[]): FakeQueryResult {
    const conditions: Array<{ column: string; paramIndex: number }> = [];
    const conditionRegex = /(\w+)\s*=\s*\$(\d+)/g;
    let match: RegExpExecArray | null;
    while ((match = conditionRegex.exec(normalizedSql)) !== null) {
      conditions.push({ column: match[1], paramIndex: Number(match[2]) - 1 });
    }

    const matches: StoredRow[] = [];
    for (const row of this.tableFor(tableName).values()) {
      const isMatch = conditions.every(({ column, paramIndex }) => {
        const expected = params[paramIndex];
        if (column === 'tenant_id') return row.tenant_id === expected;
        if (column === 'id') return row.id === expected;
        if (column in row) return row[column] === expected;
        const camelKey = column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
        const payload = row.payload as Record<string, unknown>;
        return payload[camelKey] === expected;
      });
      if (isMatch) {
        matches.push(row);
      }
    }

    const limited = /LIMIT\s+1/i.test(normalizedSql) ? matches.slice(0, 1) : matches;
    return { rows: limited.map((r) => ({ ...r })), rowCount: limited.length };
  }

  private tableFor(tableName: string): Map<string, StoredRow> {
    let table = this.tables.get(tableName);
    if (!table) {
      table = new Map();
      this.tables.set(tableName, table);
    }
    return table;
  }

  private rowKey(tenantId: string, id: string): string {
    return `${tenantId}::${id}`;
  }
}
