import { createHash } from 'crypto';
import type {
  EmbeddingRequest,
  EmbeddingResult,
  IEmbeddingProvider,
} from './embedding-provider.interface';
import { EmbeddingProviderError } from './embedding-provider.interface';
import { buildVectorSpace } from './embedding-profile';

/**
 * Deterministic local embedding provider for tests and offline development.
 * Produces a stable, content-derived unit vector of the profile's exact
 * dimension — no external API calls. It serves ONLY the exact vector spaces it
 * is configured with, preserving the exact-profile pinning contract.
 */
export class DeterministicEmbeddingProvider implements IEmbeddingProvider {
  readonly providerId: string;
  private readonly servedVectorSpaces: ReadonlySet<string>;

  constructor(
    providerId: string,
    servedModels: readonly { modelId: string; modelVersion: string; dimensions: number; distanceMetric?: string }[],
  ) {
    this.providerId = providerId;
    this.servedVectorSpaces = new Set(
      servedModels.map((m) =>
        buildVectorSpace({
          providerId: this.providerId,
          modelId: m.modelId,
          modelVersion: m.modelVersion,
          dimensions: m.dimensions,
          distanceMetric: m.distanceMetric ?? 'cosine',
        }),
      ),
    );
  }

  servesVectorSpace(vectorSpace: string): boolean {
    return this.servedVectorSpaces.has(vectorSpace);
  }

  async checkReadiness(): Promise<void> {
    // Always ready; no external dependency.
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const startedAt = new Date();
    const profile = request.profile;
    if (!this.servesVectorSpace(profile.vectorSpace)) {
      throw new EmbeddingProviderError(
        `Deterministic provider does not serve vector space ${profile.vectorSpace}`,
        this.providerId,
        'VECTOR_SPACE_NOT_SERVED',
        false,
      );
    }
    const vectors = request.texts.map((t) => this.embedText(t, profile.dimensions));
    const completedAt = new Date();
    return {
      providerId: this.providerId,
      modelId: profile.modelId,
      modelVersion: profile.modelVersion,
      embeddingProfileId: profile.embeddingProfileId,
      vectorSpace: profile.vectorSpace,
      vectors,
      dimensions: profile.dimensions,
      inputTokens: request.texts.reduce((acc, t) => acc + Math.ceil(t.length / 4), 0),
      latencyMs: completedAt.getTime() - startedAt.getTime(),
      providerRequestId: `det-${startedAt.getTime()}`,
      startedAt,
      completedAt,
    };
  }

  /** Stable content-derived unit vector of exactly `dimensions` length. */
  private embedText(text: string, dimensions: number): number[] {
    const out = new Array<number>(dimensions).fill(0);
    const hash = createHash('sha256').update(text, 'utf8').digest();
    for (let i = 0; i < dimensions; i++) {
      // Spread hash bytes deterministically across dimensions.
      const byte = hash[i % hash.length];
      const sign = (hash[(i + 7) % hash.length] & 1) === 0 ? 1 : -1;
      out[i] = sign * (byte / 255);
    }
    const norm = Math.sqrt(out.reduce((acc, v) => acc + v * v, 0)) || 1;
    return out.map((v) => v / norm);
  }
}
