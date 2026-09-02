import { loadControlledCommunicationConfig, validateControlledCommunicationConfig } from '../config/controlled-communication-config';
import type { HealthCheck, IHealthIndicator } from './health';

export interface SecretReadinessIndicatorConfig {
  readonly name?: string;
}

export class SecretReadinessIndicator implements IHealthIndicator {
  private readonly name: string;

  constructor(config: SecretReadinessIndicatorConfig = {}) {
    this.name = config.name ?? 'secrets';
  }

  async check(): Promise<HealthCheck> {
    try {
      const config = loadControlledCommunicationConfig();
      validateControlledCommunicationConfig(config);
      return {
        name: this.name,
        status: 'healthy',
        details: {
          azureKeyVaultUrlConfigured: !!config.azureKeyVaultUrl,
          graphClientSecretReferenceConfigured: !!config.graphClientSecretReference,
        },
      };
    } catch (err) {
      return {
        name: this.name,
        status: 'unhealthy',
        details: { error: err instanceof Error ? err.message : 'unknown' },
      };
    }
  }
}
