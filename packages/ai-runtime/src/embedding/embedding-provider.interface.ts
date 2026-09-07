import type { ISecretsProvider } from '@projectx/infrastructure';
import type { EmbeddingProfile } from './embedding-profile';

export interface EmbeddingRequest {
  readonly tenantId: string;
  readonly correlationId: string;
  readonly idempotencyKey?: string;
  /** The EXACT pinned profile the request must be embedded into. */
  readonly profile: EmbeddingProfile;
  readonly texts: readonly string[];
  readonly deadline?: Date;
  readonly abortSignal?: AbortSignal;
  readonly metadata?: Record<string, unknown>;
}

export interface EmbeddingResult {
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly embeddingProfileId: string;
  readonly vectorSpace: string;
  readonly vectors: readonly (readonly number[])[];
  readonly dimensions: number;
  readonly inputTokens?: number;
  readonly costUsd?: number;
  readonly latencyMs: number;
  readonly providerRequestId?: string;
  readonly startedAt: Date;
  readonly completedAt: Date;
}

export interface EmbeddingProviderConfig {
  readonly providerId: string;
  readonly baseUrl: string;
  readonly secretName: string;
  readonly secretProvider: ISecretsProvider;
  readonly defaultModelId?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface IEmbeddingProvider {
  readonly providerId: string;
  /**
   * Returns true ONLY when this provider can serve the EXACT vector space
   * identified by `vectorSpace` (same provider+model+version+dimensions+metric).
   * Implementations must NOT return true merely because dimensions match.
   */
  servesVectorSpace(vectorSpace: string): boolean;
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
  checkReadiness(): Promise<void>;
}

export class EmbeddingProviderError extends Error {
  constructor(
    message: string,
    public readonly providerId: string,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly cause?: unknown,
    /** Whether a request was actually dispatched to the provider. */
    public readonly submitted: boolean = false,
  ) {
    super(message);
    this.name = 'EmbeddingProviderError';
  }
}
