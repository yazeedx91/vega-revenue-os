export type HealthStatus = 'healthy' | 'unhealthy';

export interface HealthCheck {
  name: string;
  status: HealthStatus;
  details?: Record<string, unknown>;
}

export interface IHealthIndicator {
  check(): Promise<HealthCheck>;
}

export interface HealthReport {
  healthy: boolean;
  checks: HealthCheck[];
}

export class HealthProbe {
  private indicators: IHealthIndicator[] = [];

  add(indicator: IHealthIndicator): this {
    this.indicators.push(indicator);
    return this;
  }

  async checkAll(): Promise<HealthReport> {
    const checks = await Promise.all(
      this.indicators.map(async (indicator) => {
        try {
          return await indicator.check();
        } catch (err) {
          return {
            name: 'unknown',
            status: 'unhealthy' as const,
            details: { error: err instanceof Error ? err.message : 'unknown' },
          };
        }
      }),
    );

    const healthy = checks.every((c) => c.status === 'healthy');
    return { healthy, checks };
  }
}
