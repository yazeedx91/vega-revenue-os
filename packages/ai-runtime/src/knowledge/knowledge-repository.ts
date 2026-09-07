import type { TenantContext } from '@projectx/domain';
import { PostgresClient } from '@projectx/infrastructure';

export interface NewKnowledgeSource {
  readonly sourceId: string;
  readonly workspaceId?: string;
  readonly kind: string;
  readonly title: string;
  readonly uri?: string;
  readonly sensitivity?: string;
  readonly acl?: Record<string, unknown>;
  readonly createdBy?: string;
}

export interface NewSourceVersion {
  readonly sourceVersionId: string;
  readonly sourceId: string;
  readonly version: number;
  readonly contentHash: string;
  readonly ingestionRunId?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface NewChunk {
  readonly chunkId: string;
  readonly sourceVersionId: string;
  readonly sourceId: string;
  readonly workspaceId?: string;
  readonly seq: number;
  readonly content: string;
  readonly contentHash: string;
  readonly sensitivity?: string;
  readonly acl?: Record<string, unknown>;
}

export interface ChunkEmbeddingRow {
  readonly chunkId: string;
  readonly embeddingProfileId: string;
  readonly embedding: readonly number[];
  readonly embeddingDim: number;
  readonly contentHash: string;
}

export interface IngestionRunRow {
  readonly ingestionRunId: string;
  readonly sourceId: string;
  readonly sourceVersionId?: string;
  readonly idempotencyKey?: string;
  readonly status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PARTIAL';
  readonly triggerKind?: string;
  readonly error?: Record<string, unknown>;
  readonly stats?: Record<string, unknown>;
  readonly correlationId?: string;
}

export interface RankedKnowledgeCandidate {
  readonly chunkId: string;
  readonly sourceId: string;
  readonly content: string;
  readonly score: number;
  readonly sensitivity: string;
  readonly provenance: Record<string, unknown>;
}

export interface IKnowledgeRepository {
  upsertSource(ctx: TenantContext, source: NewKnowledgeSource): Promise<void>;
  /** Returns the existing version id when (source_id, content_hash) already exists (dedup). */
  insertSourceVersion(ctx: TenantContext, v: NewSourceVersion): Promise<{ inserted: boolean; sourceVersionId: string }>;
  insertChunk(ctx: TenantContext, chunk: NewChunk): Promise<void>;
  insertChunkEmbedding(ctx: TenantContext, row: ChunkEmbeddingRow): Promise<void>;
  startIngestionRun(ctx: TenantContext, run: IngestionRunRow): Promise<{ started: boolean }>;
  completeIngestionRun(ctx: TenantContext, runId: string, status: 'COMPLETED' | 'FAILED' | 'PARTIAL', stats?: Record<string, unknown>, error?: Record<string, unknown>): Promise<void>;
  vectorSearch(
    ctx: TenantContext,
    args: { queryVector: readonly number[]; embeddingProfileId: string; domain?: string; limit: number },
  ): Promise<RankedKnowledgeCandidate[]>;
  ftsSearch(
    ctx: TenantContext,
    args: { query: string; domain?: string; limit: number },
  ): Promise<RankedKnowledgeCandidate[]>;
}

export class PostgresKnowledgeRepository implements IKnowledgeRepository {
  constructor(private readonly client: PostgresClient) {}

  async upsertSource(ctx: TenantContext, source: NewKnowledgeSource): Promise<void> {
    await this.client.withTenant(ctx, async (client) => {
      await client.query(
        `INSERT INTO knowledge.sources
          (source_id, tenant_id, workspace_id, kind, title, uri, sensitivity, acl, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (source_id) DO NOTHING`,
        [
          source.sourceId,
          ctx.tenantId,
          source.workspaceId ?? null,
          source.kind,
          source.title,
          source.uri ?? null,
          source.sensitivity ?? 'INTERNAL',
          JSON.stringify(source.acl ?? {}),
          source.createdBy ?? null,
        ],
      );
    });
  }

  async insertSourceVersion(ctx: TenantContext, v: NewSourceVersion): Promise<{ inserted: boolean; sourceVersionId: string }> {
    return this.client.withTenant(ctx, async (client) => {
      // Dedup: reuse an existing version with the same content_hash.
      const existing = await client.query(
        `SELECT source_version_id FROM knowledge.source_versions
         WHERE source_id=$1 AND content_hash=$2 LIMIT 1`,
        [v.sourceId, v.contentHash],
      );
      if (existing.rows[0]) {
        return { inserted: false, sourceVersionId: existing.rows[0].source_version_id as string };
      }
      await client.query(
        `INSERT INTO knowledge.source_versions
          (source_version_id, source_id, tenant_id, version, content_hash, ingestion_run_id, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          v.sourceVersionId,
          v.sourceId,
          ctx.tenantId,
          v.version,
          v.contentHash,
          v.ingestionRunId ?? null,
          JSON.stringify(v.metadata ?? {}),
        ],
      );
      await client.query(
        `UPDATE knowledge.sources SET current_version_id=$1 WHERE source_id=$2`,
        [v.sourceVersionId, v.sourceId],
      );
      return { inserted: true, sourceVersionId: v.sourceVersionId };
    });
  }

  async insertChunk(ctx: TenantContext, chunk: NewChunk): Promise<void> {
    await this.client.withTenant(ctx, async (client) => {
      await client.query(
        `INSERT INTO knowledge.chunks
          (chunk_id, source_version_id, source_id, tenant_id, workspace_id, seq,
           content, content_hash, sensitivity, acl)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (source_version_id, seq) DO NOTHING`,
        [
          chunk.chunkId,
          chunk.sourceVersionId,
          chunk.sourceId,
          ctx.tenantId,
          chunk.workspaceId ?? null,
          chunk.seq,
          chunk.content,
          chunk.contentHash,
          chunk.sensitivity ?? 'INTERNAL',
          JSON.stringify(chunk.acl ?? {}),
        ],
      );
    });
  }

  async insertChunkEmbedding(ctx: TenantContext, row: ChunkEmbeddingRow): Promise<void> {
    await this.client.withTenant(ctx, async (client) => {
      await client.query(
        `INSERT INTO knowledge.chunk_embeddings
          (chunk_id, embedding_profile_id, tenant_id, embedding, embedding_dim, content_hash)
         VALUES ($1,$2,$3,$4::vector,$5,$6)
         ON CONFLICT (chunk_id, embedding_profile_id) DO NOTHING`,
        [
          row.chunkId,
          row.embeddingProfileId,
          ctx.tenantId,
          `[${row.embedding.join(',')}]`,
          row.embeddingDim,
          row.contentHash,
        ],
      );
    });
  }

  async startIngestionRun(ctx: TenantContext, run: IngestionRunRow): Promise<{ started: boolean }> {
    return this.client.withTenant(ctx, async (client) => {
      const result = await client.query(
        `INSERT INTO knowledge.ingestion_runs
          (ingestion_run_id, tenant_id, source_id, source_version_id, idempotency_key,
           status, trigger_kind, stats, correlation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
         RETURNING ingestion_run_id`,
        [
          run.ingestionRunId,
          ctx.tenantId,
          run.sourceId,
          run.sourceVersionId ?? null,
          run.idempotencyKey ?? null,
          run.status,
          run.triggerKind ?? null,
          JSON.stringify(run.stats ?? {}),
          run.correlationId ?? null,
        ],
      );
      return { started: result.rows.length > 0 };
    });
  }

  async completeIngestionRun(
    ctx: TenantContext,
    runId: string,
    status: 'COMPLETED' | 'FAILED' | 'PARTIAL',
    stats?: Record<string, unknown>,
    error?: Record<string, unknown>,
  ): Promise<void> {
    await this.client.withTenant(ctx, async (client) => {
      await client.query(
        `UPDATE knowledge.ingestion_runs
         SET status=$1, completed_at=NOW(), stats=COALESCE($2, stats), error=$3
         WHERE ingestion_run_id=$4`,
        [status, stats ? JSON.stringify(stats) : null, error ? JSON.stringify(error) : null, runId],
      );
    });
  }

  async vectorSearch(
    ctx: TenantContext,
    args: { queryVector: readonly number[]; embeddingProfileId: string; domain?: string; limit: number },
  ): Promise<RankedKnowledgeCandidate[]> {
    return this.client.withTenant(ctx, async (client) => {
      const result = await client.query(
        `SELECT c.chunk_id, c.source_id, c.content, c.sensitivity, c.acl AS provenance,
                1 - (ce.embedding <=> $1::vector) AS score
         FROM knowledge.chunk_embeddings ce
         JOIN knowledge.chunks c ON c.chunk_id = ce.chunk_id
         WHERE ce.embedding_profile_id = $2
           AND c.status = 'ACTIVE'
           AND ($3::text IS NULL OR c.acl->>'domain' = $3)
         ORDER BY ce.embedding <=> $1::vector
         LIMIT $4`,
        [`[${args.queryVector.join(',')}]`, args.embeddingProfileId, args.domain ?? null, args.limit],
      );
      return result.rows.map((r) => this.mapCandidate(r));
    });
  }

  async ftsSearch(
    ctx: TenantContext,
    args: { query: string; domain?: string; limit: number },
  ): Promise<RankedKnowledgeCandidate[]> {
    return this.client.withTenant(ctx, async (client) => {
      const result = await client.query(
        `SELECT c.chunk_id, c.source_id, c.content, c.sensitivity, c.acl AS provenance,
                ts_rank_cd(c.content_tsv, plainto_tsquery('english', $1)) AS score
         FROM knowledge.chunks c
         WHERE c.status = 'ACTIVE'
           AND c.content_tsv @@ plainto_tsquery('english', $1)
           AND ($2::text IS NULL OR c.acl->>'domain' = $2)
         ORDER BY score DESC
         LIMIT $3`,
        [args.query, args.domain ?? null, args.limit],
      );
      return result.rows.map((r) => this.mapCandidate(r));
    });
  }

  private mapCandidate(r: Record<string, unknown>): RankedKnowledgeCandidate {
    return {
      chunkId: r.chunk_id as string,
      sourceId: r.source_id as string,
      content: r.content as string,
      score: Number(r.score ?? 0),
      sensitivity: r.sensitivity as string,
      provenance: (r.provenance as Record<string, unknown>) ?? {},
    };
  }
}
