import { PostgresClient } from '@projectx/infrastructure';
import type { ISecretsProvider } from '@projectx/infrastructure';
import type { TenantContext } from '@projectx/domain';
import { buildVectorSpace } from '../embedding-profile';
import {
  ValidatedEmbeddingRuntime,
  NoActiveEmbeddingProfileStartupError,
  MultipleActiveEmbeddingProfilesError,
  DeterministicNotAllowedInProductionError,
  EmbeddingRuntimeValidationError,
} from '../embedding-runtime';

class FakeSecretsProvider implements ISecretsProvider {
  private readonly values: Record<string, string>;
  constructor(values: Record<string, string> = { 'openai/api-key': 'test-key' }) {
    this.values = values;
  }
  async getSecret(name: string): Promise<string> {
    const value = this.values[name];
    if (!value) throw new Error(`Secret ${name} not found`);
    return value;
  }
  async getCertificate(): Promise<Buffer> {
    return Buffer.from('test-cert');
  }
}

function profileRow(overrides: {
  embedding_profile_id: string;
  provider_id: string;
  model_id: string;
  model_version: string;
  dimensions: number;
  distance_metric?: string;
}): Record<string, unknown> {
  const distanceMetric = overrides.distance_metric ?? 'cosine';
  const vectorSpace = buildVectorSpace({
    providerId: overrides.provider_id,
    modelId: overrides.model_id,
    modelVersion: overrides.model_version,
    dimensions: overrides.dimensions,
    distanceMetric,
  });
  return {
    ...overrides,
    distance_metric: distanceMetric,
    vector_space: vectorSpace,
    lifecycle: 'ACTIVE',
    is_active: true,
  };
}

class FakePostgresClient {
  activeProfiles: Array<Record<string, unknown>> = [];

  async withTenant<T>(ctx: TenantContext, fn: (client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }) => Promise<T>): Promise<T> {
    const fake = {
      query: async (sql: string, _params?: unknown[]): Promise<{ rows: unknown[] }> => {
        if (sql === 'SELECT * FROM embedding.embedding_profiles WHERE is_active = TRUE') {
          return { rows: this.activeProfiles };
        }
        if (sql.includes('WHERE is_active = TRUE LIMIT 1')) {
          return { rows: this.activeProfiles.slice(0, 1) };
        }
        if (sql.includes('WHERE embedding_profile_id = $1')) {
          const id = _params?.[0];
          return { rows: this.activeProfiles.filter((p) => p.embedding_profile_id === id) };
        }
        return { rows: [] };
      },
    };
    return fn(fake as unknown as Parameters<typeof fn>[0]);
  }
}

const ctx: TenantContext = { tenantId: 'tenant-test', correlationId: 'corr-test' } as unknown as TenantContext;

function makeRuntime(activeProfiles: Array<Record<string, unknown>>): ValidatedEmbeddingRuntime {
  const client = new FakePostgresClient() as unknown as PostgresClient;
  (client as unknown as FakePostgresClient).activeProfiles = activeProfiles;
  return new ValidatedEmbeddingRuntime(client);
}

describe('ValidatedEmbeddingRuntime startup validation', () => {
  it('rejects zero ACTIVE profiles', async () => {
    const runtime = makeRuntime([]);
    await expect(runtime.validate(ctx, new FakeSecretsProvider(), { mode: 'production' })).rejects.toThrow(
      NoActiveEmbeddingProfileStartupError,
    );
  });

  it('rejects more than one ACTIVE profile', async () => {
    const runtime = makeRuntime([
      profileRow({ embedding_profile_id: 'p1', provider_id: 'openai', model_id: 'text-embedding-3-small', model_version: 'v1', dimensions: 1536 }),
      profileRow({ embedding_profile_id: 'p2', provider_id: 'openai', model_id: 'text-embedding-3-small', model_version: 'v2', dimensions: 1536 }),
    ]);
    await expect(runtime.validate(ctx, new FakeSecretsProvider(), { mode: 'production' })).rejects.toThrow(
      MultipleActiveEmbeddingProfilesError,
    );
  });

  it('rejects deterministic provider in production mode', async () => {
    const runtime = makeRuntime([
      profileRow({ embedding_profile_id: 'p1', provider_id: 'deterministic', model_id: 'det-model', model_version: 'v1', dimensions: 64 }),
    ]);
    await expect(runtime.validate(ctx, new FakeSecretsProvider(), { mode: 'production' })).rejects.toThrow(
      DeterministicNotAllowedInProductionError,
    );
  });

  it('rejects a stored vector-space identity that does not match the profile fields', async () => {
    const bad = profileRow({ embedding_profile_id: 'p1', provider_id: 'openai', model_id: 'text-embedding-3-small', model_version: 'v1', dimensions: 1536 });
    bad.vector_space = 'openai:text-embedding-3-small:v1:512:cosine';
    const runtime = makeRuntime([bad]);
    await expect(runtime.validate(ctx, new FakeSecretsProvider(), { mode: 'production' })).rejects.toThrow(
      EmbeddingRuntimeValidationError,
    );
  });

  it('rejects a dimension-only mismatch in deterministic mode', async () => {
    const row = profileRow({
      embedding_profile_id: 'p1',
      provider_id: 'deterministic',
      model_id: 'det-model',
      model_version: 'v1',
      dimensions: 128,
    });
    row.vector_space = buildVectorSpace({
      providerId: 'deterministic',
      modelId: 'det-model',
      modelVersion: 'v1',
      dimensions: 64,
      distanceMetric: 'cosine',
    });
    const runtime = makeRuntime([row]);
    await expect(runtime.validate(ctx, new FakeSecretsProvider(), { mode: 'deterministic' })).rejects.toThrow(
      EmbeddingRuntimeValidationError,
    );
  });

  it('resolves a production OpenAI profile when the secret is present', async () => {
    const runtime = makeRuntime([
      profileRow({ embedding_profile_id: 'p1', provider_id: 'openai', model_id: 'text-embedding-3-small', model_version: 'v1', dimensions: 1536 }),
    ]);
    const result = await runtime.validate(ctx, new FakeSecretsProvider(), { mode: 'production' });
    expect(result.activeProfile.providerId).toBe('openai');
    expect(result.provider.providerId).toBe('openai');
    expect(result.provider.servesVectorSpace(result.activeProfile.vectorSpace)).toBe(true);
    expect(result.router).toBeDefined();
  });

  it('resolves a deterministic profile in deterministic mode', async () => {
    const runtime = makeRuntime([
      profileRow({ embedding_profile_id: 'p1', provider_id: 'deterministic', model_id: 'det-model', model_version: 'v1', dimensions: 64 }),
    ]);
    const result = await runtime.validate(ctx, new FakeSecretsProvider(), { mode: 'deterministic' });
    expect(result.activeProfile.providerId).toBe('deterministic');
    expect(result.provider.servesVectorSpace(result.activeProfile.vectorSpace)).toBe(true);
  });

  it('fails production readiness when the embedding secret is missing', async () => {
    const runtime = makeRuntime([
      profileRow({ embedding_profile_id: 'p1', provider_id: 'openai', model_id: 'text-embedding-3-small', model_version: 'v1', dimensions: 1536 }),
    ]);
    const emptySecrets = new FakeSecretsProvider({});
    await expect(runtime.validate(ctx, emptySecrets, { mode: 'production' })).rejects.toThrow(/secret|MISSING_SECRET/i);
  });

  it('is idempotent across multiple validate calls for the same vector space', async () => {
    const runtime = makeRuntime([
      profileRow({ embedding_profile_id: 'p1', provider_id: 'deterministic', model_id: 'det-model', model_version: 'v1', dimensions: 64 }),
    ]);
    const first = await runtime.validate(ctx, new FakeSecretsProvider(), { mode: 'deterministic' });
    const second = await runtime.validate(ctx, new FakeSecretsProvider(), { mode: 'deterministic' });
    expect(second.provider).toBe(first.provider);
    expect(second.router).toBe(first.router);
  });
});
