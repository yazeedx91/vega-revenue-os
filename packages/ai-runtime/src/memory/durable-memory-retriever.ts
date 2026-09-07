import type { TenantContext } from '@projectx/domain';
import type { EmbeddingRouter } from '../embedding/embedding-router';
import type { IMemoryRetriever, MemoryEntry, MemoryQuery } from './memory-retriever.interface';
import type { IMemoryRepository, RankedMemoryCandidate } from './memory-repository';
import type { IWorkspaceAuthorizer } from './workspace-authorizer';

export interface DurableMemoryRetrieverConfig {
  /** Reciprocal-rank-fusion constant (standard 60). */
  readonly rrfK?: number;
  /** Per-channel candidate limit before fusion. */
  readonly channelLimit?: number;
  /** Final number of fused results returned. */
  readonly resultLimit?: number;
  /** Optional workspace scope for the retrieval (validated via trusted membership). */
  readonly workspaceId?: string;
}

/**
 * Durable memory retriever: hybrid retrieval over the durable memory store.
 *
 * Channels:
 *   1. Vector — query embedded via the EmbeddingRouter into the EXACT active
 *      profile, then ANN over memory.memory_embeddings.
 *   2. Keyword — real PostgreSQL FTS over memory.entries.content_tsv.
 *
 * The two ranked lists are fused with deterministic Reciprocal Rank Fusion
 * (RRF): score = Σ 1/(k + rank). Ties break deterministically by memoryId then
 * version so the same query always yields the same ordering.
 *
 * Workspace scope is enforced via the trusted IWorkspaceAuthorizer — never from
 * caller-supplied membership claims.
 */
export class DurableMemoryRetriever implements IMemoryRetriever {
  private readonly rrfK: number;
  private readonly channelLimit: number;
  private readonly resultLimit: number;

  constructor(
    private readonly repo: IMemoryRepository,
    private readonly embeddingRouter: EmbeddingRouter,
    private readonly authorizer: IWorkspaceAuthorizer,
    private readonly config: DurableMemoryRetrieverConfig = {},
  ) {
    this.rrfK = config.rrfK ?? 60;
    this.channelLimit = config.channelLimit ?? 20;
    this.resultLimit = config.resultLimit ?? 10;
  }

  async retrieve(ctx: TenantContext, query: MemoryQuery): Promise<MemoryEntry[]> {
    const scope = await this.authorizer.authorize(ctx, this.config.workspaceId);
    const workspaceId = scope.restrictedTo;

    // Channel 1: vector search under the exact active profile.
    const embedResult = await this.embeddingRouter.embed(ctx, {
      tenantId: String(ctx.tenantId),
      correlationId: String(query.correlationId),
      idempotencyKey: query.idempotencyKey ? String(query.idempotencyKey) : undefined,
      texts: [query.query],
      deadline: query.deadline,
      abortSignal: query.abortSignal,
    });
    const queryVector = embedResult.vectors[0] ?? [];
    const vectorCandidates = await this.repo.vectorSearch(ctx, {
      queryVector,
      embeddingProfileId: embedResult.embeddingProfileId,
      agentId: query.agentId,
      types: query.types,
      workspaceId,
      limit: this.channelLimit,
    });

    // Channel 2: keyword FTS.
    const ftsCandidates = await this.repo.ftsSearch(ctx, {
      query: query.query,
      agentId: query.agentId,
      types: query.types,
      workspaceId,
      limit: this.channelLimit,
    });

    const fused = this.fuse([
      { name: 'vector', candidates: vectorCandidates },
      { name: 'fts', candidates: ftsCandidates },
    ]);
    return fused.slice(0, this.resultLimit).map((c) => ({
      memoryId: c.memoryId,
      type: c.type,
      content: c.content,
      relevance: c.score,
      channel: c.channel,
    }));
  }

  /**
   * Deterministic Reciprocal Rank Fusion. Each candidate's fused score is the
   * sum of 1/(k + rank) across the channels in which it appears. Ordering is a
   * pure function of the input ranks — ties break by memoryId then version so
   * results are reproducible. The set of contributing channels is recorded for
   * provenance.
   */
  private fuse(
    channels: readonly { name: string; candidates: readonly RankedMemoryCandidate[] }[],
  ): (RankedMemoryCandidate & { channel: string })[] {
    const byKey = new Map<string, { candidate: RankedMemoryCandidate; score: number; channels: Set<string> }>();
    for (const channel of channels) {
      channel.candidates.forEach((candidate, index) => {
        const rank = index + 1;
        const key = `${candidate.memoryId}#${candidate.version}`;
        const contribution = 1 / (this.rrfK + rank);
        const existing = byKey.get(key);
        if (existing) {
          existing.score += contribution;
          existing.channels.add(channel.name);
        } else {
          byKey.set(key, { candidate, score: contribution, channels: new Set([channel.name]) });
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
        if (a.memoryId !== b.memoryId) return a.memoryId < b.memoryId ? -1 : 1;
        return a.version - b.version;
      });
  }
}
