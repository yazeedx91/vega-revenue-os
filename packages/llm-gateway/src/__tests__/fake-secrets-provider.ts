import type { ISecretsProvider } from '@projectx/infrastructure';

export class FakeSecretsProvider implements ISecretsProvider {
  constructor(private readonly secrets: Record<string, string> = {}) {}

  async getSecret(name: string): Promise<string> {
    const value = this.secrets[name];
    if (value === undefined) {
      throw new Error(`Secret not found: ${name}`);
    }
    return value;
  }

  async getCertificate(_name: string): Promise<Buffer> {
    throw new Error('Certificates not supported');
  }

  setSecret(name: string, value: string): void {
    this.secrets[name] = value;
  }
}
