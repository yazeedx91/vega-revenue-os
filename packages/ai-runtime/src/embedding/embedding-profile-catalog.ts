import type { TenantContext } from '@projectx/domain';
import { PostgresClient } from '@projectx/infrastructure';
import type { EmbeddingProfile, EmbeddingProfileLifecycle } from './embedding-profile';

/**
 * Resolves embedding profiles from the global registry. Profiles are
 * system-level (not tenant-scoped); the registry is read-only for the
 * application role. The ACTIVE profile is the single live vector space.
 */
export interface IEmbeddingProfileCatalog {
  /** The single ACTIVE profile, or undefined when none is active. */
  getActive(ctx: TenantContext): Promise<EmbeddingProfile | undefined>;
  getById(ctx: TenantContext, embeddingProfileId: string): Promise<EmbeddingProfile | undefined>;
}

export class PostgresEmbeddingProfileCatalog implements IEmbeddingProfileCatalog {
  constructor(private readonly client: PostgresClient) {}

  async getActive(ctx: TenantContext): Promise<EmbeddingProfile | undefined> {
    return this.client.withTenant(ctx, async (client) => {
      const result = await client.query(
        `SELECT * FROM embedding.embedding_profiles WHERE is_active = TRUE LIMIT 1`,
      );
      return result.rows[0] ? this.mapRow(result.rows[0]) : undefined;
    });
  }

  async getById(ctx: TenantContext, embeddingProfileId: string): Promise<EmbeddingProfile | undefined> {
    return this.client.withTenant(ctx, async (client) => {
      const result = await client.query(
        `SELECT * FROM embedding.embedding_profiles WHERE embedding_profile_id = $1`,
        [embeddingProfileId],
      );
      return result.rows[0] ? this.mapRow(result.rows[0]) : undefined;
    });
  }

  private mapRow(row: Record<string, unknown>): EmbeddingProfile {
    return {
      embeddingProfileId: row.embedding_profile_id as string,
      providerId: row.provider_id as string,
      modelId: row.model_id as string,
      modelVersion: row.model_version as string,
      dimensions: Number(row.dimensions),
      distanceMetric: row.distance_metric as string,
      vectorSpace: row.vector_space as string,
      lifecycle: row.lifecycle as EmbeddingProfileLifecycle,
      isActive: Boolean(row.is_active),
    };
  }
}
