import { ClientSecretCredential } from '@azure/identity';

export interface EntraTokenProviderConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export interface ITokenProvider {
  getAccessToken(scopes: string[]): Promise<string>;
}

/**
 * Acquires OAuth2 access tokens using an Entra ID application registration.
 * The client secret is provided from the caller (usually retrieved from ISecretsProvider).
 */
export class EntraTokenProvider implements ITokenProvider {
  private readonly credential: ClientSecretCredential;

  constructor(config: EntraTokenProviderConfig) {
    this.credential = new ClientSecretCredential(config.tenantId, config.clientId, config.clientSecret);
  }

  async getAccessToken(scopes: string[]): Promise<string> {
    const token = await this.credential.getToken(scopes);
    if (!token || !token.token) {
      throw new Error('Failed to acquire access token');
    }
    return token.token;
  }
}
