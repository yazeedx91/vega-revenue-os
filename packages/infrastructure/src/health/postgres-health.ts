import type { Pool } from 'pg';
import type { HealthCheck, IHealthIndicator } from './health';

export interface PostgresHealthIndicatorConfig {
  readonly pool: Pool;
  readonly name?: string;
}

export class PostgresHealthIndicator implements IHealthIndicator {
  private readonly name: string;
  private readonly pool: Pool;

  constructor(config: PostgresHealthIndicatorConfig) {
    this.pool = config.pool;
    this.name = config.name ?? 'postgres';
  }

  async check(): Promise<HealthCheck> {
    try {
      await this.pool.query('SELECT 1');
      return { name: this.name, status: 'healthy' };
    } catch (err) {
      return {
        name: this.name,
        status: 'unhealthy',
        details: { error: err instanceof Error ? err.message : 'unknown' },
      };
    }
  }
}
