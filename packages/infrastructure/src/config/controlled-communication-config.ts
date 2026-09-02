export interface ControlledCommunicationConfig {
  readonly liveEmailEnabled: boolean;
  readonly mode: string;
  readonly databaseUrl?: string;
  readonly redisUrl?: string;
  readonly temporalAddress?: string;
  readonly temporalNamespace: string;
  readonly graphWebhookCallbackUrl?: string;
  readonly adminApiKey?: string;
  readonly adminApiKeySecretReference?: string;
  readonly azureKeyVaultUrl?: string;
  readonly graphTenantId?: string;
  readonly graphClientId?: string;
  readonly graphClientSecret?: string;
  readonly graphClientSecretReference?: string;
}

export function loadControlledCommunicationConfig(): ControlledCommunicationConfig {
  return {
    liveEmailEnabled: process.env.OUTREACH_LIVE_EMAIL_ENABLED === 'true',
    mode: process.env.OUTREACH_MODE ?? 'ALLOWLIST_ONLY',
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    temporalAddress: process.env.TEMPORAL_ADDRESS,
    temporalNamespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    graphWebhookCallbackUrl: process.env.GRAPH_WEBHOOK_CALLBACK_URL,
    adminApiKey: process.env.ADMIN_API_KEY,
    adminApiKeySecretReference: process.env.ADMIN_API_KEY_SECRET_REFERENCE,
    azureKeyVaultUrl: process.env.AZURE_KEY_VAULT_URL,
    graphTenantId: process.env.GRAPH_TENANT_ID,
    graphClientId: process.env.GRAPH_CLIENT_ID,
    graphClientSecret: process.env.GRAPH_CLIENT_SECRET,
    graphClientSecretReference: process.env.GRAPH_CLIENT_SECRET_REFERENCE,
  };
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function validateControlledCommunicationConfig(config: ControlledCommunicationConfig): void {
  const errors: string[] = [];

  if (!config.liveEmailEnabled && !isProduction()) {
    // In disabled mode we only require the mode to be present for consistency.
    return;
  }

  if (isProduction()) {
    if (!config.azureKeyVaultUrl) {
      errors.push('AZURE_KEY_VAULT_URL is required in production');
    }
    if (config.adminApiKey && !config.adminApiKeySecretReference) {
      errors.push('ADMIN_API_KEY_SECRET_REFERENCE is required in production (raw ADMIN_API_KEY is not allowed)');
    }
    const hasAnyGraphConfig = Boolean(config.graphTenantId || config.graphClientId);
    if (hasAnyGraphConfig) {
      if (!config.graphClientSecretReference) {
        errors.push('GRAPH_CLIENT_SECRET_REFERENCE is required in production');
      }
      if (config.graphClientSecret) {
        errors.push('GRAPH_CLIENT_SECRET must not be set in production (use GRAPH_CLIENT_SECRET_REFERENCE)');
      }
    }
  }

  const missing: string[] = [];

  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }

  if (!config.liveEmailEnabled) {
    // In production disabled mode the reference-only checks above still ran.
    return;
  }

  if (config.mode !== 'ALLOWLIST_ONLY') {
    throw new Error(
      `OUTREACH_MODE must be 'ALLOWLIST_ONLY' when live email is enabled, got: ${config.mode ?? 'undefined'}`,
    );
  }

  if (!config.databaseUrl) {
    missing.push('DATABASE_URL');
  }

  if (!config.redisUrl) {
    missing.push('REDIS_URL');
  }

  const hasGraphCredential =
    config.graphTenantId && config.graphClientId && (config.graphClientSecret || config.graphClientSecretReference);
  if (!hasGraphCredential) {
    missing.push('GRAPH_TENANT_ID + GRAPH_CLIENT_ID + (GRAPH_CLIENT_SECRET | GRAPH_CLIENT_SECRET_REFERENCE)');
  }

  if (missing.length > 0) {
    throw new Error(
      `Controlled communication is enabled but required configuration is missing: ${missing.join(', ')}`,
    );
  }
}
