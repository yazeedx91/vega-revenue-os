import type { TenantContext } from '@projectx/domain';
import { PostgresClient } from '@projectx/infrastructure';

export interface MemoryEntryRow {
  readonly memoryId: string;
  readonly tenantId: string;
  readonly workspaceId?: string;
  readonly agentId?: string;
  readonly type: string;
  readonly subjectKind?: string;
  readonly subjectId?: string;
  readonly content: string;
  readonly contentHash: string;
  readonly version: number;
  readonly status: string;
  readonly sensitivity: string;
  readonly confidence?: number;
  readonly provenance: Record<string, unknown>;
  readonly sourceExecutionId?: string;
  readonly sourceCorrelationId?: string;
  readonly observedAt?: Date;
  readonly expiresAt?: Date;
  readonly createdAt: Date;
  readonly createdBy?: string;
  readonly supersedes?: string;
}

export interface NewMemoryEntry {
  readonly memoryId: string;
  readonly workspaceId?: string;
  readonly agentId?: string;
  readonly type: string;
  readonly subjectKind?: string;
  readonly subjectId?: string;
  readonly content: string;
  readonly contentHash: string;
  readonly version: number;
  readonly sensitivity?: string;
  readonly confidence?: number;
  readonly provenance?: Record<string, unknown>;
  readonly sourceExecutionId?: string;
  readonly sourceCorrelationId?: string;
  readonly observedAt?: Date;
  readonly expiresAt?: Date;
  readonly createdBy?: string;
  readonly supersedes?: string;
}

export interface MemoryEmbeddingRow {
  readonly memoryId: string;
  readonly version: number;
  readonly embeddingProfileId: string;
  readonly embedding: readonly number[];
  readonly embeddingDim: number;
  readonly contentHash: string;
}

export interface MemoryWriteRequestRow {
  readonly writeRequestId: string;
  readonly idempotencyKey?: string;
  readonly agentId?: string;
  readonly workspaceId?: string;
  readonly type?: string;
  readonly decision: 'ACCEPTED' | 'REJECTED' | 'QUARANTINED';
  readonly rejectionReason?: string;
  readonly contentHash?: string;
  readonly memoryId?: string;
  readonly version?: number;
  readonly correlationId?: string;
}

/** A single ranked candidate from one retrieval channel (vector or FTS). */
export interface RankedMemoryCandidate {
  readonly memoryId: string;
  readonly version: number;
  readonly score: number;
  readonly content: string;
  readonly type: string;
  readonly workspaceId?: string;
  readonly provenance: Record<string, unknown>;
}

export interface IMemoryRepository {
  insertEntry(ctx: TenantContext, entry: NewMemoryEntry): Promise<void>;
  supersede(ctx: TenantContext, memoryId: string, version: number): Promise<void>;
  insertEmbedding(ctx: TenantContext, row: MemoryEmbeddingRow): Promise<void>;
  recordWriteRequest(ctx: TenantContext, row: MemoryWriteRequestRow): Promise<void>;
  /** Vector channel: nearest neighbours under the EXACT active profile. */
  vectorSearch(
    ctx: TenantContext,
    args: {
      queryVector: readonly number[];
      embeddingProfileId: string;
      agentId?: string;
      types: readonly string[];
      workspaceId?: string;
      limit: number;
    },
  ): Promise<RankedMemoryCandidate[]>;
  /** Keyword channel: real PostgreSQL FTS over the canonical content. */
  ftsSearch(
    ctx: TenantContext,
    args: {
      query: string;
      agentId?: string;
      types: readonly string[];
      workspaceId?: string;
      limit: number;
    },
  ): Promise<RankedMemoryCandidate[]>;
}

export class PostgresMemoryRepository implements IMemoryRepository {
  constructor(private readonly client: PostgresClient) {}

  async insertEntry(ctx: TenantContext, entry: NewMemoryEntry): Promise<void> {
    await this.client.withTenant(ctx, async (client) => {
      await client.query(
        `INSERT INTO memory.entries
          (memory_id, tenant_id, workspace_id, agent_id, type, subject_kind, subject_id,
           content, content_hash, version, status, sensitivity, confidence, provenance,
           source_execution_id, source_correlation_id, observed_at, expires_at, created_by, supersedes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ACTIVE',$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [
          entry.memoryId,
          ctx.tenantId,
          entry.workspaceId ?? null,
          entry.agentId ?? null,
          entry.type,
          entry.subjectKind ?? null,
          entry.subjectId ?? null,
          entry.content,
          entry.contentHash,
          entry.version,
          entry.sensitivity ?? 'INTERNAL',
          entry.confidence ?? null,
          JSON.stringify(entry.provenance ?? {}),
          entry.sourceExecutionId ?? null,
          entry.sourceCorrelationId ?? null,
          entry.observedAt ?? null,
          entry.expiresAt ?? null,
          entry.createdBy ?? null,
          entry.supersedes ?? null,
        ],
      );
    });
  }

  async supersede(ctx: TenantContext, memoryId: string, version: number): Promise<void> {
    await this.client.withTenant(ctx, async (client) => {
      await client.query(
        `UPDATE memory.entries SET status='SUPERSEDED'
         WHERE tenant_id=$1 AND memory_id=$2 AND version=$3`,
        [ctx.tenantId, memoryId, version],
      );
    });
  }

  async insertEmbedding(ctx: TenantContext, row: MemoryEmbeddingRow): Promise<void> {
    await this.client.withTenant(ctx, async (client) => {
      await client.query(
        `INSERT INTO memory.memory_embeddings
          (tenant_id, memory_id, version, embedding_profile_id, embedding, embedding_dim, content_hash)
         VALUES ($1,$2,$3,$4,$5::vector,$6,$7)
         ON CONFLICT (tenant_id, memory_id, version, embedding_profile_id) DO NOTHING`,
        [
          ctx.tenantId,
          row.memoryId,
          row.version,
          row.embeddingProfileId,
          `[${row.embedding.join(',')}]`,
          row.embeddingDim,
          row.contentHash,
        ],
      );
    });
  }

  async recordWriteRequest(ctx: TenantContext, row: MemoryWriteRequestRow): Promise<void> {
    await this.client.withTenant(ctx, async (client) => {
      await client.query(
        `INSERT INTO memory.write_requests
          (write_request_id, tenant_id, idempotency_key, agent_id, workspace_id, type,
           decision, rejection_reason, content_hash, memory_id, version, correlation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          row.writeRequestId,
          ctx.tenantId,
          row.idempotencyKey ?? null,
          row.agentId ?? null,
          row.workspaceId ?? null,
          row.type ?? null,
          row.decision,
          row.rejectionReason ?? null,
          row.contentHash ?? null,
          row.memoryId ?? null,
          row.version ?? null,
          row.correlationId ?? null,
        ],
      );
    });
  }

  async vectorSearch(
    ctx: TenantContext,
    args: {
      queryVector: readonly number[];
      embeddingProfileId: string;
      agentId?: string;
      types: readonly string[];
      workspaceId?: string;
      limit: number;
    },
  ): Promise<RankedMemoryCandidate[]> {
    return this.client.withTenant(ctx, async (client) => {
      const result = await client.query(
        `SELECT e.memory_id, e.version, e.content, e.type, e.workspace_id, e.provenance,
                1 - (me.embedding <=> $1::vector) AS score
         FROM memory.memory_embeddings me
         JOIN memory.entries e
           ON e.tenant_id = me.tenant_id AND e.memory_id = me.memory_id AND e.version = me.version
         WHERE me.embedding_profile_id = $2
           AND e.status = 'ACTIVE'
           AND (e.expires_at IS NULL OR e.expires_at > NOW())
           AND ($3::text IS NULL OR e.agent_id = $3)
           AND ($4::text[] IS NULL OR e.type = ANY($4))
           AND ($5::text IS NULL OR e.workspace_id = $5)
         ORDER BY me.embedding <=> $1::vector
         LIMIT $6`,
        [
          `[${args.queryVector.join(',')}]`,
          args.embeddingProfileId,
          args.agentId ?? null,
          args.types.length ? args.types : null,
          args.workspaceId ?? null,
          args.limit,
        ],
      );
      return result.rows.map((r) => this.mapCandidate(r));
    });
  }

  async ftsSearch(
    ctx: TenantContext,
    args: {
      query: string;
      agentId?: string;
      types: readonly string[];
      workspaceId?: string;
      limit: number;
    },
  ): Promise<RankedMemoryCandidate[]> {
    return this.client.withTenant(ctx, async (client) => {
      const result = await client.query(
        `SELECT e.memory_id, e.version, e.content, e.type, e.workspace_id, e.provenance,
                ts_rank_cd(e.content_tsv, plainto_tsquery('english', $1)) AS score
         FROM memory.entries e
         WHERE e.status = 'ACTIVE'
           AND (e.expires_at IS NULL OR e.expires_at > NOW())
           AND e.content_tsv @@ plainto_tsquery('english', $1)
           AND ($2::text IS NULL OR e.agent_id = $2)
           AND ($3::text[] IS NULL OR e.type = ANY($3))
           AND ($4::text IS NULL OR e.workspace_id = $4)
         ORDER BY score DESC
         LIMIT $5`,
        [
          args.query,
          args.agentId ?? null,
          args.types.length ? args.types : null,
          args.workspaceId ?? null,
          args.limit,
        ],
      );
      return result.rows.map((r) => this.mapCandidate(r));
    });
  }

  private mapCandidate(r: Record<string, unknown>): RankedMemoryCandidate {
    return {
      memoryId: r.memory_id as string,
      version: Number(r.version),
      score: Number(r.score ?? 0),
      content: r.content as string,
      type: r.type as string,
      workspaceId: (r.workspace_id as string) ?? undefined,
      provenance: (r.provenance as Record<string, unknown>) ?? {},
    };
  }
}
