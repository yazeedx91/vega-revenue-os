import { createHash, randomUUID } from 'crypto';
import type { TenantContext } from '@projectx/domain';
import type { EmbeddingRouter } from '../embedding/embedding-router';
import type { IContentScrubber, ISecretDetector } from '../memory/memory-write-policy';
import type { IKnowledgeRepository } from './knowledge-repository';

export interface IngestKnowledgeRequest {
  readonly sourceId: string;
  readonly kind: string;
  readonly title: string;
  readonly uri?: string;
  readonly workspaceId?: string;
  readonly domain?: string;
  readonly sensitivity?: string;
  /** Raw source content — scrubbed before any chunk is persisted. */
  readonly content: string;
  readonly idempotencyKey?: string;
  readonly correlationId?: string;
  readonly triggerKind?: string;
  /** Chunk size in characters (default ~1200). */
  readonly chunkSize?: number;
}

export interface IngestKnowledgeResult {
  readonly ingestionRunId: string;
  readonly sourceId: string;
  readonly sourceVersionId?: string;
  readonly status: 'COMPLETED' | 'FAILED' | 'PARTIAL' | 'DEDUPED';
  readonly chunkCount: number;
  readonly deduplicated: boolean;
}

/**
 * Knowledge ingestion service. Chunks raw source content, scrubs each chunk,
 * rejects secret-bearing chunks, dedups whole-source versions by content hash,
 * embeds each chunk into the EXACT active profile, and records a durable
 * ingestion_runs lineage/idempotency row.
 *
 * Idempotency: a repeated call with the same idempotency_key returns the
 * already-recorded run without re-ingesting (the unique index on
 * (tenant_id, idempotency_key) is the backstop).
 */
export class KnowledgeIngestionService {
  constructor(
    private readonly repo: IKnowledgeRepository,
    private readonly embeddingRouter: EmbeddingRouter,
    private readonly scrubber: IContentScrubber,
    private readonly secretDetector?: ISecretDetector,
  ) {}

  async ingest(ctx: TenantContext, request: IngestKnowledgeRequest): Promise<IngestKnowledgeResult> {
    const ingestionRunId = `ing-${randomUUID()}`;
    const { started } = await this.repo.startIngestionRun(ctx, {
      ingestionRunId,
      sourceId: request.sourceId,
      idempotencyKey: request.idempotencyKey,
      status: 'RUNNING',
      triggerKind: request.triggerKind ?? 'MANUAL',
      correlationId: request.correlationId ?? String(ctx.correlationId),
    });
    if (!started) {
      // Idempotent replay: a run with this idempotency key already exists.
      return {
        ingestionRunId,
        sourceId: request.sourceId,
        status: 'DEDUPED',
        chunkCount: 0,
        deduplicated: true,
      };
    }

    try {
      await this.repo.upsertSource(ctx, {
        sourceId: request.sourceId,
        workspaceId: request.workspaceId,
        kind: request.kind,
        title: request.title,
        uri: request.uri,
        sensitivity: request.sensitivity,
        acl: request.domain ? { domain: request.domain } : {},
        createdBy: ctx.userId,
      });

      const contentHash = this.hash(request.content);
      const sourceVersionId = `sv-${randomUUID()}`;
      const version = await this.repo.insertSourceVersion(ctx, {
        sourceVersionId,
        sourceId: request.sourceId,
        version: 1,
        contentHash,
        ingestionRunId,
        metadata: { domain: request.domain },
      });
      if (!version.inserted) {
        await this.repo.completeIngestionRun(ctx, ingestionRunId, 'COMPLETED', { deduplicated: true });
        return {
          ingestionRunId,
          sourceId: request.sourceId,
          sourceVersionId: version.sourceVersionId,
          status: 'DEDUPED',
          chunkCount: 0,
          deduplicated: true,
        };
      }

      const chunkSize = request.chunkSize ?? 1200;
      const rawChunks = this.chunk(request.content, chunkSize);
      let persisted = 0;
      for (let i = 0; i < rawChunks.length; i++) {
        const raw = rawChunks[i];
        // Never persist secret-bearing chunks.
        if (this.secretDetector?.containsSecret(raw)) {
          continue;
        }
        const canonical = this.scrubber.scrub(raw);
        if (!canonical || canonical.trim().length === 0) {
          continue;
        }
        const chunkId = `chk-${randomUUID()}`;
        const chunkHash = this.hash(canonical);
        await this.repo.insertChunk(ctx, {
          chunkId,
          sourceVersionId: version.sourceVersionId,
          sourceId: request.sourceId,
          workspaceId: request.workspaceId,
          seq: i,
          content: canonical,
          contentHash: chunkHash,
          sensitivity: request.sensitivity,
          acl: request.domain ? { domain: request.domain } : {},
        });

        const embedResult = await this.embeddingRouter.embed(ctx, {
          tenantId: String(ctx.tenantId),
          correlationId: request.correlationId ?? String(ctx.correlationId),
          texts: [canonical],
        });
        const vector = embedResult.vectors[0];
        if (vector) {
          await this.repo.insertChunkEmbedding(ctx, {
            chunkId,
            embeddingProfileId: embedResult.embeddingProfileId,
            embedding: vector,
            embeddingDim: embedResult.dimensions,
            contentHash: chunkHash,
          });
        }
        persisted++;
      }

      const status = persisted === 0 && rawChunks.length > 0 ? 'PARTIAL' : 'COMPLETED';
      await this.repo.completeIngestionRun(ctx, ingestionRunId, status, {
        chunkCount: persisted,
        rawChunkCount: rawChunks.length,
      });
      return {
        ingestionRunId,
        sourceId: request.sourceId,
        sourceVersionId: version.sourceVersionId,
        status,
        chunkCount: persisted,
        deduplicated: false,
      };
    } catch (err) {
      await this.repo.completeIngestionRun(ctx, ingestionRunId, 'FAILED', undefined, {
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  private chunk(content: string, size: number): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < content.length; i += size) {
      chunks.push(content.slice(i, i + size));
    }
    return chunks.length ? chunks : [content];
  }

  private hash(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex');
  }
}
