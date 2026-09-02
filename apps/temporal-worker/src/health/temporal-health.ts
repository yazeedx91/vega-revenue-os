import type { HealthCheck, IHealthIndicator } from '@projectx/infrastructure';

export interface TemporalConnectionState {
  /** True when the worker is currently connected to a Temporal server. */
  connected: boolean;
}

export interface TemporalHealthIndicatorConfig {
  readonly state: TemporalConnectionState;
  readonly name?: string;
}

export class TemporalHealthIndicator implements IHealthIndicator {
  private readonly name: string;
  private readonly state: TemporalConnectionState;

  constructor(config: TemporalHealthIndicatorConfig) {
    this.name = config.name ?? 'temporal';
    this.state = config.state;
  }

  async check(): Promise<HealthCheck> {
    if (this.state.connected) {
      return { name: this.name, status: 'healthy' };
    }
    return {
      name: this.name,
      status: 'unhealthy',
      details: { reason: 'Worker is not connected to Temporal' },
    };
  }
}
