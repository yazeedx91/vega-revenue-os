import type { TenantContext } from '@projectx/domain';
import type { EmbeddingRouter } from '../embedding/embedding-router';
import type { IKnowledgeRetriever, KnowledgeEntry, KnowledgeQuery } from './knowledge-retriever.interface';
import type { IKnowledgeRepository, RankedKnowledgeCandidate } from './knowledge-repository';

export interface DurableKnowledgeRetrieverConfig {
  readonly rrfK?: number;
  readonly channelLimit?: number;
  readonly resultLimit?: number;
}

/**
 * Durable knowledge retriever: hybrid retrieval over the durable knowledge
 * store. RLS already scopes results to the current tenant PLUS read-only global
 * rows (tenant_id IS NULL); the retriever never widens that scope.
 *
 * Channels: vector ANN under the EXACT active profile + real PostgreSQL FTS,
 * fused with deterministic Reciprocal Rank Fusion (ties break by chunkId).
 */
export class DurableKnowledgeRetriever implements IKnowledgeRetriever {
  private readonly rrfK: number;
  private readonly channelLimit: number;
  private readonly resultLimit: number;

  constructor(
    private readonly repo: IKnowledgeRepository,
    private readonly embeddingRouter: EmbeddingRouter,
    config: DurableKnowledgeRetrieverConfig = {},
  ) {
    this.rrfK = config.rrfK ?? 60;
    this.channelLimit = config.channelLimit ?? 20;
    this.resultLimit = config.resultLimit ?? 10;
  }

  async retrieve(ctx: TenantContext, query: KnowledgeQuery): Promise<KnowledgeEntry[]> {
    const embedResult = await this.embeddingRouter.embed(ctx, {
      tenantId: String(ctx.tenantId),
      correlationId: String(query.correlationId),
      idempotencyKey: query.idempotencyKey ? String(query.idempotencyKey) : undefined,
      texts: [query.query],
      deadline: query.deadline,
      abortSignal: query.abortSignal,
    });
    const queryVector = embedResult.vectors[0] ?? [];

    const [vectorCandidates, ftsCandidates] = await Promise.all([
      this.repo.vectorSearch(ctx, {
        queryVector,
        embeddingProfileId: embedResult.embeddingProfileId,
        domain: query.domain,
        limit: this.channelLimit,
      }),
      this.repo.ftsSearch(ctx, {
        query: query.query,
        domain: query.domain,
        limit: this.channelLimit,
      }),
    ]);

    const fused = this.fuse([
      { name: 'vector', candidates: vectorCandidates },
      { name: 'fts', candidates: ftsCandidates },
    ]);
    return fused.slice(0, this.resultLimit).map((c) => ({
      knowledgeId: c.chunkId,
      domain: query.domain,
      content: c.content,
      relevance: c.score,
      channel: c.channel,
    }));
  }

  private fuse(
    channels: readonly { name: string; candidates: readonly RankedKnowledgeCandidate[] }[],
  ): (RankedKnowledgeCandidate & { channel: string })[] {
    const byKey = new Map<string, { candidate: RankedKnowledgeCandidate; score: number; channels: Set<string> }>();
    for (const channel of channels) {
      channel.candidates.forEach((candidate, index) => {
        const rank = index + 1;
        const contribution = 1 / (this.rrfK + rank);
        const existing = byKey.get(candidate.chunkId);
        if (existing) {
          existing.score += contribution;
          existing.channels.add(channel.name);
        } else {
          byKey.set(candidate.chunkId, { candidate, score: contribution, channels: new Set([channel.name]) });
        }
      });
    }
    return Array.from(byKey.values())
      .map(({ candidate, score, channels }) => ({
        ...candidate,
        score,
        channel: Array.from(channels).sort().join('+'),
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.chunkId < b.chunkId ? -1 : 1;
      });
  }
}
