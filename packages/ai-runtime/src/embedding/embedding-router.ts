import type { TenantContext } from '@projectx/domain';
import { EmbeddingProviderError } from './embedding-provider.interface';
import type {
  EmbeddingRequest,
  EmbeddingResult,
  IEmbeddingProvider,
} from './embedding-provider.interface';
import type { EmbeddingProfile } from './embedding-profile';
import type { IEmbeddingProfileCatalog } from './embedding-profile-catalog';
import type { IEmbeddingProviderRegistry } from './embedding-provider-registry';

export interface EmbeddingInvokeRequest {
  readonly tenantId: string;
  readonly correlationId: string;
  readonly idempotencyKey?: string;
  readonly texts: readonly string[];
  /**
   * Optional explicit profile pin. When omitted the single ACTIVE profile is
   * used. When supplied, the profile must resolve AND be ACTIVE — the router
   * never silently substitutes a different vector space.
   */
  readonly embeddingProfileId?: string;
  readonly deadline?: Date;
  readonly abortSignal?: AbortSignal;
  readonly metadata?: Record<string, unknown>;
}

export class NoActiveEmbeddingProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoActiveEmbeddingProfileError';
  }
}

export class IncompatibleEmbeddingProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncompatibleEmbeddingProfileError';
  }
}

export class NoEmbeddingProviderError extends Error {
  constructor(
    public readonly vectorSpace: string,
    message: string,
  ) {
    super(message);
    this.name = 'NoEmbeddingProviderError';
  }
}

export type EmbeddingUsageListener = (result: EmbeddingResult) => Promise<void> | void;

/**
 * Routes embedding requests to a provider that serves the EXACT active vector
 * space. Fallback is permitted ONLY among providers that serve the identical
 * `vectorSpace` (same provider+model+version+dimensions+metric). The router
 * never falls back to a different model/provider merely because dimensions
 * match — if no provider serves the exact active profile, embedding fails safe
 * and no incompatible vector is produced.
 */
export class EmbeddingRouter {
  constructor(
    private readonly catalog: IEmbeddingProfileCatalog,
    private readonly registry: IEmbeddingProviderRegistry,
    private readonly usageListener?: EmbeddingUsageListener,
  ) {}

  async embed(ctx: TenantContext, request: EmbeddingInvokeRequest): Promise<EmbeddingResult> {
    const profile = await this.resolveProfile(ctx, request.embeddingProfileId);
    const candidates = this.registry
      .all()
      .filter((p) => p.servesVectorSpace(profile.vectorSpace));

    if (candidates.length === 0) {
      throw new NoEmbeddingProviderError(
        profile.vectorSpace,
        `No embedding provider serves the exact active vector space ${profile.vectorSpace}`,
      );
    }

    const errors: EmbeddingProviderError[] = [];
    for (const provider of candidates) {
      const providerRequest: EmbeddingRequest = {
        tenantId: request.tenantId,
        correlationId: request.correlationId,
        idempotencyKey: request.idempotencyKey,
        profile,
        texts: request.texts,
        deadline: request.deadline,
        abortSignal: request.abortSignal,
        metadata: request.metadata,
      };
      try {
        const result = await provider.embed(providerRequest);
        this.assertExactProfile(profile, result);
        if (this.usageListener) {
          await this.usageListener(result);
        }
        return result;
      } catch (err) {
        if (err instanceof EmbeddingProviderError) {
          errors.push(err);
          if (!err.retryable) {
            throw err;
          }
          continue;
        }
        const unwrapped = err instanceof Error ? err : new Error(String(err));
        throw new EmbeddingProviderError(
          unwrapped.message,
          provider.providerId,
          'ROUTER_UNEXPECTED_ERROR',
          false,
          unwrapped,
        );
      }
    }

    const message = errors.map((e) => `${e.providerId}: ${e.message}`).join('; ');
    throw new EmbeddingProviderError(
      `All embedding providers failed for vector space ${profile.vectorSpace}: ${message}`,
      'router',
      'ALL_PROVIDERS_FAILED',
      errors.some((e) => e.retryable),
    );
  }

  private async resolveProfile(
    ctx: TenantContext,
    embeddingProfileId?: string,
  ): Promise<EmbeddingProfile> {
    const profile = embeddingProfileId
      ? await this.catalog.getById(ctx, embeddingProfileId)
      : await this.catalog.getActive(ctx);

    if (!profile) {
      throw new NoActiveEmbeddingProfileError(
        embeddingProfileId
          ? `Embedding profile ${embeddingProfileId} not found`
          : 'No ACTIVE embedding profile is registered',
      );
    }
    if (profile.lifecycle !== 'ACTIVE' || !profile.isActive) {
      throw new IncompatibleEmbeddingProfileError(
        `Embedding profile ${profile.embeddingProfileId} is not ACTIVE (lifecycle=${profile.lifecycle}); refusing to embed into a non-live vector space`,
      );
    }
    return profile;
  }

  /**
   * Defense-in-depth: even a provider that claims to serve the vector space
   * must return a result whose profile identity and dimensionality match the
   * pinned profile exactly. A mismatch is a hard, non-retryable failure so an
   * incompatible vector is never persisted.
   */
  private assertExactProfile(profile: EmbeddingProfile, result: EmbeddingResult): void {
    if (
      result.embeddingProfileId !== profile.embeddingProfileId ||
      result.vectorSpace !== profile.vectorSpace ||
      result.modelId !== profile.modelId ||
      result.modelVersion !== profile.modelVersion ||
      result.dimensions !== profile.dimensions
    ) {
      throw new EmbeddingProviderError(
        `Provider ${result.providerId} returned an embedding for a different vector space ` +
          `(expected ${profile.vectorSpace}, got ${result.vectorSpace}); refusing incompatible vector`,
        result.providerId,
        'INCOMPATIBLE_VECTOR_SPACE',
        false,
      );
    }
    for (const vector of result.vectors) {
      if (vector.length !== profile.dimensions) {
        throw new EmbeddingProviderError(
          `Provider ${result.providerId} returned a ${vector.length}-dim vector for profile ` +
            `${profile.embeddingProfileId} (${profile.dimensions}-dim); refusing incompatible vector`,
          result.providerId,
          'INCOMPATIBLE_DIMENSION',
          false,
        );
      }
    }
  }
}
