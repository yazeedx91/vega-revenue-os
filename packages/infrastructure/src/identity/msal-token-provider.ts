import { ConfidentialClientApplication, type Configuration } from '@azure/msal-node';
import type { ITokenProvider } from './entra-token-provider';

/** Raised when Entra ID token acquisition fails (auth misconfiguration, network, etc.). */
export class TokenAcquisitionError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'TokenAcquisitionError';
  }
}

export interface MsalTokenProviderConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

/**
 * Implements the existing `ITokenProvider` abstraction using
 * `@azure/msal-node`'s `ConfidentialClientApplication` client-credentials
 * (daemon/service-to-service) flow. MSAL's built-in in-memory token cache is
 * relied upon as-is; no second custom cache is implemented here. Credentials
 * must be sourced from `ISecretsProvider` by the caller — never hardcoded,
 * logged, or embedded in domain/application state.
 */
export class MsalTokenProvider implements ITokenProvider {
  private readonly clientApp: ConfidentialClientApplication;

  constructor(config: MsalTokenProviderConfig) {
    const msalConfig: Configuration = {
      auth: {
        clientId: config.clientId,
        authority: `https://login.microsoftonline.com/${config.tenantId}`,
        clientSecret: config.clientSecret,
      },
    };
    this.clientApp = new ConfidentialClientApplication(msalConfig);
  }

  async getAccessToken(scopes: string[]): Promise<string> {
    try {
      const result = await this.clientApp.acquireTokenByClientCredential({ scopes });
      if (!result?.accessToken) {
        throw new TokenAcquisitionError('MSAL returned no access token');
      }
      return result.accessToken;
    } catch (err) {
      if (err instanceof TokenAcquisitionError) throw err;
      throw new TokenAcquisitionError(err instanceof Error ? err.message : 'Unknown token acquisition failure', err);
    }
  }
}
