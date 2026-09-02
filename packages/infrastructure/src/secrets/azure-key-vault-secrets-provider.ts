import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import type { ISecretsProvider } from './secrets.interface';

export interface AzureKeyVaultSecretsProviderConfig {
  vaultUrl: string;
}

/**
 * Production secrets provider backed by Azure Key Vault.
 * Secret names are normalized by replacing '/' with '-' because Key Vault
 * secret names cannot contain slashes.
 */
export class AzureKeyVaultSecretsProvider implements ISecretsProvider {
  private readonly client: SecretClient;

  constructor(config: AzureKeyVaultSecretsProviderConfig) {
    const credential = new DefaultAzureCredential();
    this.client = new SecretClient(config.vaultUrl, credential);
  }

  private normalizeName(name: string): string {
    return name.replace(/\//g, '-').toLowerCase();
  }

  async getSecret(name: string): Promise<string> {
    const secret = await this.client.getSecret(this.normalizeName(name));
    if (!secret.value) {
      throw new Error(`Secret ${name} has no value`);
    }
    return secret.value;
  }

  async getCertificate(name: string): Promise<Buffer> {
    const value = await this.getSecret(name);
    return Buffer.from(value, 'base64');
  }
}
