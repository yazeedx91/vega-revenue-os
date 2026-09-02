import type { HealthCheck, IHealthIndicator } from './health';
import type { RedisConnectionManager } from '../cache/redis-connection-manager';

export interface RedisHealthIndicatorConfig {
  readonly manager: RedisConnectionManager;
  readonly name?: string;
}

export class RedisHealthIndicator implements IHealthIndicator {
  private readonly name: string;
  private readonly manager: RedisConnectionManager;

  constructor(config: RedisHealthIndicatorConfig) {
    this.manager = config.manager;
    this.name = config.name ?? 'redis';
  }

  async check(): Promise<HealthCheck> {
    try {
      const healthy = await this.manager.isHealthy();
      if (!healthy) {
        return { name: this.name, status: 'unhealthy', details: { reason: 'Redis client reports unhealthy' } };
      }
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
