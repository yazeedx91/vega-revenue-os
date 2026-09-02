import {
  type ControlledCommunicationConfig,
  validateControlledCommunicationConfig,
} from '../controlled-communication-config';

describe('validateControlledCommunicationConfig', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  const liveConfig: ControlledCommunicationConfig = {
    liveEmailEnabled: true,
    mode: 'ALLOWLIST_ONLY',
    databaseUrl: 'postgresql://user:pass@localhost:5432/db',
    redisUrl: 'redis://localhost:6379',
    temporalAddress: 'localhost:7233',
    temporalNamespace: 'default',
    graphTenantId: 'tenant-id',
    graphClientId: 'client-id',
    graphClientSecret: 'client-secret',
  };

  it('passes for live outbound email config without GRAPH_WEBHOOK_CALLBACK_URL', () => {
    expect(liveConfig.graphWebhookCallbackUrl).toBeUndefined();
    expect(() => validateControlledCommunicationConfig(liveConfig)).not.toThrow();
  });

  it('accepts GRAPH_CLIENT_SECRET_REFERENCE in place of GRAPH_CLIENT_SECRET', () => {
    const config: ControlledCommunicationConfig = {
      ...liveConfig,
      graphClientSecret: undefined,
      graphClientSecretReference: 'kv://secrets/graph-client-secret',
    };
    expect(() => validateControlledCommunicationConfig(config)).not.toThrow();
  });

  it('still fails when Graph credentials are missing', () => {
    const config: ControlledCommunicationConfig = {
      ...liveConfig,
      graphTenantId: undefined,
      graphClientId: undefined,
      graphClientSecret: undefined,
      graphClientSecretReference: undefined,
    };
    expect(() => validateControlledCommunicationConfig(config)).toThrow(
      /GRAPH_TENANT_ID \+ GRAPH_CLIENT_ID \+ \(GRAPH_CLIENT_SECRET \| GRAPH_CLIENT_SECRET_REFERENCE\)/,
    );
  });

  it('still fails when only the client secret is missing', () => {
    const config: ControlledCommunicationConfig = {
      ...liveConfig,
      graphClientSecret: undefined,
    };
    expect(() => validateControlledCommunicationConfig(config)).toThrow(/GRAPH_CLIENT_SECRET/);
  });

  it('still fails when OUTREACH_MODE is not ALLOWLIST_ONLY', () => {
    const config: ControlledCommunicationConfig = { ...liveConfig, mode: 'OPEN' };
    expect(() => validateControlledCommunicationConfig(config)).toThrow(
      /OUTREACH_MODE must be 'ALLOWLIST_ONLY'/,
    );
  });

  it('still fails when DATABASE_URL is missing', () => {
    const config: ControlledCommunicationConfig = { ...liveConfig, databaseUrl: undefined };
    expect(() => validateControlledCommunicationConfig(config)).toThrow(/DATABASE_URL/);
  });

  it('still fails when REDIS_URL is missing', () => {
    const config: ControlledCommunicationConfig = { ...liveConfig, redisUrl: undefined };
    expect(() => validateControlledCommunicationConfig(config)).toThrow(/REDIS_URL/);
  });

  it('is a no-op when live email is disabled, even with everything else missing', () => {
    const config: ControlledCommunicationConfig = {
      liveEmailEnabled: false,
      mode: 'OPEN',
      temporalNamespace: 'default',
    };
    expect(() => validateControlledCommunicationConfig(config)).not.toThrow();
  });

  it('rejects production without AZURE_KEY_VAULT_URL', () => {
    process.env.NODE_ENV = 'production';
    const config: ControlledCommunicationConfig = {
      ...liveConfig,
      liveEmailEnabled: false,
      azureKeyVaultUrl: undefined,
    };
    expect(() => validateControlledCommunicationConfig(config)).toThrow(/AZURE_KEY_VAULT_URL/);
  });

  it('rejects production with only a raw GRAPH_CLIENT_SECRET', () => {
    process.env.NODE_ENV = 'production';
    const config: ControlledCommunicationConfig = {
      ...liveConfig,
      liveEmailEnabled: false,
      azureKeyVaultUrl: 'https://vault.vault.azure.net',
      graphClientSecret: 'raw-secret',
      graphClientSecretReference: undefined,
    };
    expect(() => validateControlledCommunicationConfig(config)).toThrow(/GRAPH_CLIENT_SECRET/);
  });

  it('rejects production with both raw and reference (raw is never allowed)', () => {
    process.env.NODE_ENV = 'production';
    const config: ControlledCommunicationConfig = {
      ...liveConfig,
      liveEmailEnabled: false,
      azureKeyVaultUrl: 'https://vault.vault.azure.net',
      graphClientSecret: 'raw-secret',
      graphClientSecretReference: 'kv://secrets/graph-client-secret',
    };
    expect(() => validateControlledCommunicationConfig(config)).toThrow(/GRAPH_CLIENT_SECRET must not be set/);
  });

  it('accepts production with reference and vault', () => {
    process.env.NODE_ENV = 'production';
    const config: ControlledCommunicationConfig = {
      ...liveConfig,
      liveEmailEnabled: false,
      azureKeyVaultUrl: 'https://vault.vault.azure.net',
      graphClientSecret: undefined,
      graphClientSecretReference: 'kv://secrets/graph-client-secret',
    };
    expect(() => validateControlledCommunicationConfig(config)).not.toThrow();
  });

  it('rejects production with raw ADMIN_API_KEY', () => {
    process.env.NODE_ENV = 'production';
    const config: ControlledCommunicationConfig = {
      ...liveConfig,
      liveEmailEnabled: false,
      azureKeyVaultUrl: 'https://vault.vault.azure.net',
      adminApiKey: 'raw-admin-key',
    };
    expect(() => validateControlledCommunicationConfig(config)).toThrow(/ADMIN_API_KEY_SECRET_REFERENCE/);
  });
});
