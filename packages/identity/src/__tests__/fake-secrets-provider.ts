import type { ISecretsProvider } from '@projectx/infrastructure';

export class FakeSecretsProvider implements ISecretsProvider {
  constructor(private readonly secrets: Record<string, string>) {}

  async getSecret(name: string): Promise<string> {
    const value = this.secrets[name];
    if (value === undefined) {
      throw new Error(`Secret not found: ${name}`);
    }
    return value;
  }

  setSecret(name: string, value: string): void {
    this.secrets[name] = value;
  }

  async getCertificate(_name: string): Promise<Buffer> {
    throw new Error('FakeSecretsProvider does not support certificates');
  }
}
