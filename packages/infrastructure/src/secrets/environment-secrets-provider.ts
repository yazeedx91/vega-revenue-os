import type { ISecretsProvider } from './secrets.interface';

export interface EnvironmentSecretsProviderConfig {
  prefix?: string;
}

/**
 * Development-only secrets provider that reads from environment variables.
 * Secrets must be upper-cased and use underscores in place of separators.
 * Example: secret name "projectx/tenant-1/email/graph-client-secret" becomes
 * "PROJECTX_TENANT_1_EMAIL_GRAPH_CLIENT_SECRET".
 */
export class EnvironmentSecretsProvider implements ISecretsProvider {
  constructor(private readonly config: EnvironmentSecretsProviderConfig = {}) {}

  private envName(name: string): string {
    const prefix = this.config.prefix ?? '';
    const normalized = name.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase();
    return prefix ? `${prefix}_${normalized}` : normalized;
  }

  async getSecret(name: string): Promise<string> {
    const value = process.env[this.envName(name)];
    if (!value) {
      throw new Error(`Secret not found in environment: ${name}`);
    }
    return value;
  }

  async getCertificate(name: string): Promise<Buffer> {
    const value = process.env[this.envName(name)];
    if (!value) {
      throw new Error(`Certificate not found in environment: ${name}`);
    }
    return Buffer.from(value, 'base64');
  }
}
