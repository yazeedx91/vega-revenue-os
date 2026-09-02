export interface ISecretsProvider {
  getSecret(name: string): Promise<string>;
  getCertificate(name: string): Promise<Buffer>;
}
