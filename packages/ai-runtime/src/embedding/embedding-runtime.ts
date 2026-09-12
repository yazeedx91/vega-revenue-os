import type { TenantContext } from '@projectx/domain';
import { PostgresClient } from '@projectx/infrastructure';
import type { ISecretsProvider } from '@projectx/infrastructure';
import { buildVectorSpace } from './embedding-profile';
import type { EmbeddingDistanceMetric, EmbeddingProfile, EmbeddingProfileLifecycle } from './embedding-profile';
import { PostgresEmbeddingProfileCatalog } from './embedding-profile-catalog';
import { EmbeddingProviderRegistry } from './embedding-provider-registry';
import { EmbeddingRouter } from './embedding-router';
import { DeterministicEmbeddingProvider } from './deterministic-embedding-provider';
import { OpenAIEmbeddingProvider } from './openai-embedding-provider';
import type { IEmbeddingProvider } from './embedding-provider.interface';

export type EmbeddingRuntimeMode = 'production' | 'deterministic';

export interface EmbeddingRuntimeStartupOptions {
  /**
   * Deployment mode. Production refuses deterministic providers and
   * performs a live secret readiness check.
   */
  readonly mode: EmbeddingRuntimeMode;
  /** OpenAI-compatible base URL. Default https://api.openai.com. */
  readonly openAiBaseUrl?: string;
  /** Secret reference for the production embedding API key. Default openai/api-key. */
  readonly openAiSecretName?: string;
  /** Request timeout for production embedding calls. */
  readonly openAiTimeoutMs?: number;
  /** Optional fetch implementation (for deterministic test mocks). */
  readonly fetchImpl?: typeof fetch;
}

export interface ResolvedEmbeddingRuntime {
  /** The validated single active embedding profile for this deployment. */
  readonly activeProfile: EmbeddingProfile;
  /** Provider serving the exact active vector space. */
  readonly provider: IEmbeddingProvider;
  /** Router that resolves the active profile and embeds through the provider. */
  readonly router: EmbeddingRouter;
}

export class EmbeddingRuntimeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingRuntimeValidationError';
  }
}

export class NoActiveEmbeddingProfileStartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoActiveEmbeddingProfileStartupError';
  }
}

export class MultipleActiveEmbeddingProfilesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MultipleActiveEmbeddingProfilesError';
  }
}

export class DeterministicNotAllowedInProductionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeterministicNotAllowedInProductionError';
  }
}

/**
 * Single production composition boundary for the embedding runtime.
 *
 * Responsibilities:
 *   - resolve the single ACTIVE durable embedding profile;
 *   - fail closed when zero or more than one active profile exists;
 *   - build and register a provider matching the exact profile
 *     (provider + model + modelVersion + dimensions + distanceMetric);
 *   - reject deterministic providers in production;
 *   - run a readiness check on the chosen provider before mission execution;
 *   - expose one shared {@link EmbeddingRouter} for agent context,
 *     memory writes and knowledge writes.
 */
export class ValidatedEmbeddingRuntime {
  private readonly client: PostgresClient;
  /** Catalog backed by durable Postgres. */
  readonly catalog: PostgresEmbeddingProfileCatalog;
  /** Registry; empty until {@link validate} succeeds. */
  readonly registry: EmbeddingProviderRegistry;
  /** Router wired to the catalog and the registry. */
  readonly router: EmbeddingRouter;

  constructor(client: PostgresClient) {
    this.client = client;
    this.catalog = new PostgresEmbeddingProfileCatalog(client);
    this.registry = new EmbeddingProviderRegistry();
    this.router = new EmbeddingRouter(this.catalog, this.registry);
  }

  /**
   * Validates the active profile and builds the one matching provider.
   * Must be called and resolve before any mission or API request is served.
   */
  async validate(
    ctx: TenantContext,
    secrets: ISecretsProvider,
    options: EmbeddingRuntimeStartupOptions,
  ): Promise<ResolvedEmbeddingRuntime> {
    const activeRows = await this.client.withTenant(ctx, async (client) => {
      const result = await client.query('SELECT * FROM embedding.embedding_profiles WHERE is_active = TRUE');
      return result.rows as Array<Record<string, unknown>>;
    });

    if (activeRows.length === 0) {
      throw new NoActiveEmbeddingProfileStartupError(
        'Embedding startup failed: no ACTIVE embedding profile is registered.',
      );
    }
    if (activeRows.length > 1) {
      throw new MultipleActiveEmbeddingProfilesError(
        `Embedding startup failed: expected exactly one ACTIVE embedding profile, found ${activeRows.length}.`,
      );
    }

    const row = activeRows[0];
    const activeProfile: EmbeddingProfile = {
      embeddingProfileId: row.embedding_profile_id as string,
      providerId: row.provider_id as string,
      modelId: row.model_id as string,
      modelVersion: row.model_version as string,
      dimensions: Number(row.dimensions),
      distanceMetric: (row.distance_metric as string) ?? 'cosine',
      vectorSpace: row.vector_space as string,
      lifecycle: row.lifecycle as EmbeddingProfileLifecycle,
      isActive: Boolean(row.is_active),
    };

    if (activeProfile.lifecycle !== 'ACTIVE' || !activeProfile.isActive) {
      throw new EmbeddingRuntimeValidationError(
        `Embedding startup failed: resolved profile ${activeProfile.embeddingProfileId} is not ACTIVE.`,
      );
    }

    const computedVectorSpace = buildVectorSpace({
      providerId: activeProfile.providerId,
      modelId: activeProfile.modelId,
      modelVersion: activeProfile.modelVersion,
      dimensions: activeProfile.dimensions,
      distanceMetric: activeProfile.distanceMetric,
    });
    if (computedVectorSpace !== activeProfile.vectorSpace) {
      throw new EmbeddingRuntimeValidationError(
        `Embedding startup failed: profile ${activeProfile.embeddingProfileId} vector-space identity mismatch. ` +
          `stored=${activeProfile.vectorSpace}, computed=${computedVectorSpace}.`,
      );
    }

    const servedModel = {
      modelId: activeProfile.modelId,
      modelVersion: activeProfile.modelVersion,
      dimensions: activeProfile.dimensions,
      distanceMetric: activeProfile.distanceMetric,
    };

    let provider: IEmbeddingProvider;
    if (options.mode === 'deterministic') {
      provider = new DeterministicEmbeddingProvider(activeProfile.providerId, [servedModel]);
    } else {
      if (activeProfile.providerId === 'deterministic') {
        throw new DeterministicNotAllowedInProductionError(
          'Embedding startup failed: deterministic provider is not allowed in production.',
        );
      }
      provider = new OpenAIEmbeddingProvider(
        {
          providerId: activeProfile.providerId,
          baseUrl: options.openAiBaseUrl ?? 'https://api.openai.com',
          secretName: options.openAiSecretName ?? 'openai/api-key',
          secretProvider: secrets,
          timeoutMs: options.openAiTimeoutMs,
          fetchImpl: options.fetchImpl,
        },
        [servedModel],
      );
      await provider.checkReadiness();
    }

    if (!provider.servesVectorSpace(activeProfile.vectorSpace)) {
      throw new EmbeddingRuntimeValidationError(
        `Embedding startup failed: registered ${provider.providerId} provider does not serve ` +
          `the active vector space ${activeProfile.vectorSpace}.`,
      );
    }

    const existing = this.registry.get(provider.providerId);
    if (existing) {
      if (existing.servesVectorSpace(activeProfile.vectorSpace)) {
        return {
          activeProfile,
          provider: existing,
          router: this.router,
        };
      }
      throw new EmbeddingRuntimeValidationError(
        `Embedding startup failed: provider ${provider.providerId} is already registered for a different vector space.`,
      );
    }

    this.registry.register(provider);

    return {
      activeProfile,
      provider,
      router: this.router,
    };
  }
}
