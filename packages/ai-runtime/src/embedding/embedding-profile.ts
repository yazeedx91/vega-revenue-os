/**
 * An embedding profile is the authoritative identity of an EXACT vector space.
 *
 * Two profiles are compatible ONLY when every component of `vectorSpace`
 * matches: provider + model + modelVersion + dimensions + distanceMetric.
 * Identical dimensionality does NOT imply a compatible vector space, so the
 * router never falls back across different profiles/models/providers.
 */
export type EmbeddingProfileLifecycle =
  | 'DRAFT'
  | 'INDEXING'
  | 'READY'
  | 'ACTIVE'
  | 'DRAINING'
  | 'RETIRED';

export type EmbeddingDistanceMetric = 'cosine' | 'l2' | 'ip' | string;

export interface EmbeddingProfile {
  readonly embeddingProfileId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly dimensions: number;
  readonly distanceMetric: EmbeddingDistanceMetric;
  /** Canonical vector-space identity, e.g. `openai:text-embedding-3-small:v1:1536:cosine`. */
  readonly vectorSpace: string;
  readonly lifecycle: EmbeddingProfileLifecycle;
  readonly isActive: boolean;
}

/**
 * Builds the canonical vector-space identity for a profile. Every component is
 * part of the identity so that "same dimension" can never be conflated with
 * "same vector space".
 */
export function buildVectorSpace(input: {
  providerId: string;
  modelId: string;
  modelVersion: string;
  dimensions: number;
  distanceMetric: EmbeddingDistanceMetric;
}): string {
  return [
    input.providerId,
    input.modelId,
    input.modelVersion,
    String(input.dimensions),
    input.distanceMetric,
  ].join(':');
}
