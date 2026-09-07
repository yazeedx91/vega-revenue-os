import { createHash, randomUUID } from 'crypto';
import type { TenantContext } from '@projectx/domain';
import type { EmbeddingRouter } from '../embedding/embedding-router';
import type { IMemoryRepository } from './memory-repository';
import type { IWorkspaceAuthorizer } from './workspace-authorizer';

/**
 * Minimal content-scrubber port. Satisfied structurally by the conversation
 * package's `IPIIScrubber` — ai-runtime does not depend on that package, so the
 * port is declared here and bound at composition time.
 */
export interface IContentScrubber {
  scrub(input: string): string;
}

/**
 * Optional secret detector. When provided, candidate content that appears to
 * contain a secret is rejected outright — secrets are never persisted to
 * durable memory.
 */
export interface ISecretDetector {
  containsSecret(input: string): boolean;
}

export type MemoryWriteDecision = 'ACCEPTED' | 'REJECTED' | 'QUARANTINED';

export interface MemoryWriteRequest {
  readonly agentId?: string;
  readonly workspaceId?: string;
  readonly type: string;
  readonly subjectKind?: string;
  readonly subjectId?: string;
  /** Candidate content — may be unsafe; it is scrubbed before persistence. */
  readonly content: string;
  readonly sensitivity?: string;
  readonly confidence?: number;
  readonly provenance?: Record<string, unknown>;
  readonly sourceExecutionId?: string;
  readonly sourceCorrelationId?: string;
  readonly observedAt?: Date;
  readonly expiresAt?: Date;
  readonly idempotencyKey?: string;
  readonly correlationId?: string;
  /** When set, supersedes the current ACTIVE version of this memoryId. */
  readonly memoryId?: string;
}

export interface MemoryWriteResult {
  readonly decision: MemoryWriteDecision;
  readonly memoryId?: string;
  readonly version?: number;
  readonly rejectionReason?: string;
  readonly contentHash: string;
}

/** Patterns that indicate raw chain-of-thought / unsafe internal reasoning. */
const RAW_COT_PATTERNS: readonly RegExp[] = [
  /\bchain[- ]of[- ]thought\b/i,
  /\bmy (internal|private) reasoning\b/i,
  /<thinking>[\s\S]*<\/thinking>/i,
  /\bstep[- ]by[- ]step reasoning\b/i,
];

/**
 * Write-policy gate for durable memory. Enforces:
 *   - Trusted workspace authorization before any write.
 *   - Secret rejection: candidate content containing a secret is never stored.
 *   - Raw-CoT rejection: internal reasoning markers are never stored.
 *   - Canonical-only persistence: only the SCRUBBED content is written; the raw
 *     candidate is never persisted (the audit row stores only its hash).
 *   - Deterministic content hashing for dedup.
 *   - Embedding into the EXACT active profile via the EmbeddingRouter.
 *   - A write_requests audit row for every decision.
 */
export class MemoryWritePolicyService {
  constructor(
    private readonly repo: IMemoryRepository,
    private readonly embeddingRouter: EmbeddingRouter,
    private readonly authorizer: IWorkspaceAuthorizer,
    private readonly scrubber: IContentScrubber,
    private readonly secretDetector?: ISecretDetector,
  ) {}

  async write(ctx: TenantContext, request: MemoryWriteRequest): Promise<MemoryWriteResult> {
    // Trusted workspace authorization — throws when the user is not a member.
    await this.authorizer.authorize(ctx, request.workspaceId);

    const contentHash = this.hash(request.content);
    const writeRequestId = `wr-${randomUUID()}`;

    // Gate 1: secrets are never persisted.
    if (this.secretDetector?.containsSecret(request.content)) {
      await this.audit(ctx, writeRequestId, request, 'REJECTED', 'SECRET_DETECTED', contentHash);
      return { decision: 'REJECTED', rejectionReason: 'SECRET_DETECTED', contentHash };
    }

    // Gate 2: raw chain-of-thought is never persisted.
    if (RAW_COT_PATTERNS.some((p) => p.test(request.content))) {
      await this.audit(ctx, writeRequestId, request, 'REJECTED', 'RAW_COT_DETECTED', contentHash);
      return { decision: 'REJECTED', rejectionReason: 'RAW_COT_DETECTED', contentHash };
    }

    // Canonical content = scrubbed candidate. Only this is persisted.
    const canonical = this.scrubber.scrub(request.content);
    if (!canonical || canonical.trim().length === 0) {
      await this.audit(ctx, writeRequestId, request, 'REJECTED', 'EMPTY_AFTER_SCRUB', contentHash);
      return { decision: 'REJECTED', rejectionReason: 'EMPTY_AFTER_SCRUB', contentHash };
    }
    const canonicalHash = this.hash(canonical);

    const memoryId = request.memoryId ?? `mem-${randomUUID()}`;
    const version = 1; // versioning/supersede handled by consolidation workflow

    await this.repo.insertEntry(ctx, {
      memoryId,
      workspaceId: request.workspaceId,
      agentId: request.agentId,
      type: request.type,
      subjectKind: request.subjectKind,
      subjectId: request.subjectId,
      content: canonical,
      contentHash: canonicalHash,
      version,
      sensitivity: request.sensitivity,
      confidence: request.confidence,
      provenance: request.provenance,
      sourceExecutionId: request.sourceExecutionId,
      sourceCorrelationId: request.sourceCorrelationId,
      observedAt: request.observedAt,
      expiresAt: request.expiresAt,
      createdBy: ctx.userId,
      supersedes: request.memoryId,
    });

    // Embed the canonical content into the EXACT active profile.
    const embedResult = await this.embeddingRouter.embed(ctx, {
      tenantId: String(ctx.tenantId),
      correlationId: request.correlationId ?? String(ctx.correlationId),
      idempotencyKey: request.idempotencyKey,
      texts: [canonical],
    });
    const vector = embedResult.vectors[0];
    if (vector) {
      await this.repo.insertEmbedding(ctx, {
        memoryId,
        version,
        embeddingProfileId: embedResult.embeddingProfileId,
        embedding: vector,
        embeddingDim: embedResult.dimensions,
        contentHash: canonicalHash,
      });
    }

    await this.audit(ctx, writeRequestId, request, 'ACCEPTED', undefined, contentHash, memoryId, version);
    return { decision: 'ACCEPTED', memoryId, version, contentHash: canonicalHash };
  }

  private async audit(
    ctx: TenantContext,
    writeRequestId: string,
    request: MemoryWriteRequest,
    decision: MemoryWriteDecision,
    rejectionReason: string | undefined,
    contentHash: string,
    memoryId?: string,
    version?: number,
  ): Promise<void> {
    await this.repo.recordWriteRequest(ctx, {
      writeRequestId,
      idempotencyKey: request.idempotencyKey,
      agentId: request.agentId,
      workspaceId: request.workspaceId,
      type: request.type,
      decision,
      rejectionReason,
      contentHash,
      memoryId,
      version,
      correlationId: request.correlationId ?? String(ctx.correlationId),
    });
  }

  private hash(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex');
  }
}
