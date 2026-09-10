import type { Pool, PoolClient } from 'pg';
import { AuthorizationError, Signal, TenantIsolationError } from '@projectx/domain';
import { asAccountId, asContactId, asEvidenceId, asSignalId, asTenantId } from '@projectx/shared';
import type { ISignalRepository, SignalRepositoryContext } from '@projectx/infrastructure';
import { ConcurrencyConflictError, DuplicateRecordError, PostgresClient, toRequiredDate } from '@projectx/infrastructure';

function toNumber(value: unknown): number {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error('Invalid numeric value in signal row');
  return result;
}

function rowToSignal(row: Record<string, unknown>): Signal {
  return Signal.reconstitute(
    {
      id: asSignalId(row.signal_id as string),
      tenantId: asTenantId(row.tenant_id as string),
      workspaceId: row.workspace_id as string,
      accountId: asAccountId(row.account_id as string),
      contactId: row.contact_id ? asContactId(row.contact_id as string) : undefined,
      signalType: row.signal_type as any,
      observedAt: toRequiredDate(row.observed_at as string | Date),
      effectiveFrom: toRequiredDate(row.effective_from as string | Date),
      effectiveUntil: toRequiredDate(row.effective_until as string | Date),
      source: row.source as string,
      sourceUri: row.source_uri as string | undefined,
      confidence: toNumber(row.confidence),
      relevance: toNumber(row.relevance),
      observedSignal: row.observed_signal as string,
      interpretedSignal: row.interpreted_signal as string,
      evidenceIds: ((row.evidence_ids as string[]) ?? []).map(asEvidenceId),
      status: row.status as any,
      dedupIdentity: row.dedup_identity as string,
      createdAt: toRequiredDate(row.created_at as string | Date),
    },
    row.signal_version as number,
  );
}

const FIND_BY_ID_SQL = `SELECT * FROM intelligence.signals
  WHERE tenant_id = $1 AND workspace_id = $2 AND signal_id = $3 LIMIT 1`;

const FIND_ACTIVE_BY_ACCOUNT_SQL = `SELECT * FROM intelligence.signals
  WHERE tenant_id = $1 AND workspace_id = $2 AND account_id = $3
    AND status = 'ACTIVE' AND effective_from <= $4 AND effective_until > $4`;

const INSERT_SQL = `INSERT INTO intelligence.signals (
  signal_id, tenant_id, workspace_id, account_id, contact_id, signal_type,
  observed_at, effective_from, effective_until, source, source_uri,
  confidence, relevance, observed_signal, interpreted_signal, evidence_ids,
  status, dedup_identity, signal_version, created_at, updated_at
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`;

const UPDATE_SQL = `UPDATE intelligence.signals SET
  status = $5, signal_version = $6, updated_at = $7
  WHERE tenant_id = $1 AND workspace_id = $2 AND signal_id = $3 AND signal_version = $4`;

export class PostgresSignalRepository implements ISignalRepository {
  private readonly client: PostgresClient;

  constructor(pool: Pool) {
    this.client = new PostgresClient(pool);
  }

  async findById(ctx: SignalRepositoryContext, id: string): Promise<Signal | null> {
    return this.client.withTenant(ctx, async (client: PoolClient) => {
      const result = await client.query(FIND_BY_ID_SQL, [ctx.tenantId, ctx.workspaceId, id]);
      return result.rows.length > 0 ? rowToSignal(result.rows[0]) : null;
    });
  }

  async findByDedupIdentity(ctx: SignalRepositoryContext, dedupIdentity: string): Promise<Signal | null> {
    return this.client.withTenant(ctx, async (client: PoolClient) => {
      const result = await client.query(
        `SELECT * FROM intelligence.signals WHERE tenant_id = $1 AND workspace_id = $2 AND dedup_identity = $3 LIMIT 1`,
        [ctx.tenantId, ctx.workspaceId, dedupIdentity],
      );
      return result.rows.length > 0 ? rowToSignal(result.rows[0]) : null;
    });
  }

  async findActiveByAccount(ctx: SignalRepositoryContext, accountId: string, evaluatedAt: Date): Promise<Signal[]> {
    if (!(evaluatedAt instanceof Date) || Number.isNaN(evaluatedAt.getTime())) {
      throw new Error('evaluatedAt must be a valid Date');
    }
    return this.client.withTenant(ctx, async (client: PoolClient) => {
      const result = await client.query(FIND_ACTIVE_BY_ACCOUNT_SQL, [ctx.tenantId, ctx.workspaceId, accountId, evaluatedAt]);
      return result.rows.map(rowToSignal);
    });
  }

  async save(ctx: SignalRepositoryContext, signal: Signal): Promise<void> {
    if (ctx.tenantId !== signal.tenantId) {
      throw new TenantIsolationError(`Signal tenant ${signal.tenantId} does not match context tenant ${ctx.tenantId}`);
    }
    if (ctx.workspaceId !== signal.workspaceId) {
      throw new AuthorizationError(`Signal workspace ${signal.workspaceId} does not match authorized workspace ${ctx.workspaceId}`);
    }

    await this.client.withTenant(ctx, async (client: PoolClient) => {
      if (signal.loadedVersion === undefined) {
        try {
          await client.query(INSERT_SQL, [
            signal.id, ctx.tenantId, ctx.workspaceId, signal.accountId, signal.contactId ?? null,
            signal.signalType, signal.observedAt, signal.effectiveFrom, signal.effectiveUntil,
            signal.source, signal.sourceUri ?? null, signal.confidence, signal.relevance,
            signal.observedSignal, signal.interpretedSignal, signal.evidenceIds, signal.status,
            signal.dedupIdentity, signal.version, signal.createdAt, new Date(),
          ]);
        } catch (err) {
          const pgErr = err as { code?: string; constraint?: string };
          if (pgErr.code === '23505' && pgErr.constraint === 'signals_workspace_dedup') {
            throw new DuplicateRecordError(`Duplicate signal ${signal.id}`, ctx.tenantId as string, signal.id as string, 'dedup_identity');
          }
          if (pgErr.code === '23505') {
            throw new ConcurrencyConflictError(`Signal ${signal.id} already exists`, ctx.tenantId as string, signal.id as string, undefined);
          }
          throw new Error(`Persistence failure for signal ${signal.id}`);
        }
      } else {
        const expectedVersion = signal.loadedVersion;
        const result = await client.query(UPDATE_SQL, [
          ctx.tenantId, ctx.workspaceId, signal.id, expectedVersion, signal.status, signal.version, new Date(),
        ]);
        if (result.rowCount === 0) {
          throw new ConcurrencyConflictError(`Stale version for signal ${signal.id}`, ctx.tenantId as string, signal.id as string, expectedVersion);
        }
      }
    });
    signal.setVersion(signal.version);
  }
}
