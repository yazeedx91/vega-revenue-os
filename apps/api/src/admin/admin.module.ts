import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import {
  AzureKeyVaultSecretsProvider,
  ConsoleTelemetry,
  EnvironmentSecretsProvider,
  MsalTokenProvider,
  NoOpTelemetry,
  OpenTelemetryAdapter,
  PostgresAuditLog,
} from '@projectx/infrastructure';
import type { ISecretsProvider, ITelemetry } from '@projectx/infrastructure';
import { GraphSubscriptionAdminService, GraphSubscriptionClient, PostgresGraphSubscriptionRepository } from '@projectx/outreach';
import { AdminApiKeyGuard } from './admin-api-key.guard';
import { AdminGraphSubscriptionController } from './admin-graph-subscription.controller';

function createSecretsProvider(): ISecretsProvider {
  const vaultUrl = process.env.AZURE_KEY_VAULT_URL;
  if (vaultUrl) {
    return new AzureKeyVaultSecretsProvider({ vaultUrl });
  }
  return new EnvironmentSecretsProvider();
}

function createTelemetry(): ITelemetry {
  const telemetryMode = process.env.TELEMETRY_MODE ?? 'console';
  if (telemetryMode === 'opentelemetry') {
    return new OpenTelemetryAdapter({ serviceName: 'projectx-api' });
  }
  if (telemetryMode === 'noop') {
    return new NoOpTelemetry();
  }
  return new ConsoleTelemetry({ serviceName: 'projectx-api' });
}

async function resolveSecretValue(
  secrets: ISecretsProvider,
  envValue: string | undefined,
  secretReference: string | undefined,
): Promise<string | undefined> {
  if (envValue) return envValue;
  if (secretReference) {
    try {
      return await secrets.getSecret(secretReference);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

@Module({
  controllers: [AdminGraphSubscriptionController],
  providers: [
    {
      provide: 'SECRETS_PROVIDER',
      useFactory: createSecretsProvider,
    },
    {
      provide: 'TELEMETRY',
      useFactory: createTelemetry,
    },
    {
      provide: AdminApiKeyGuard,
      useFactory: async (secrets: ISecretsProvider) => {
        const key = await resolveSecretValue(
          secrets,
          process.env.ADMIN_API_KEY,
          process.env.ADMIN_API_KEY_SECRET_REFERENCE,
        );
        return new AdminApiKeyGuard({ getExpectedKey: () => key });
      },
      inject: ['SECRETS_PROVIDER'],
    },
    {
      provide: GraphSubscriptionAdminService,
      useFactory: async (secrets: ISecretsProvider, telemetry: ITelemetry) => {
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        const tenantId = process.env.GRAPH_TENANT_ID ?? 'common';
        const clientId = process.env.GRAPH_CLIENT_ID ?? '';
        const clientSecret = await resolveSecretValue(
          secrets,
          process.env.GRAPH_CLIENT_SECRET,
          process.env.GRAPH_CLIENT_SECRET_REFERENCE,
        );
        const tokenProvider = new MsalTokenProvider({ tenantId, clientId, clientSecret: clientSecret ?? '' });
        const client = new GraphSubscriptionClient({ tokenProvider });
        const repository = new PostgresGraphSubscriptionRepository({ pool });
        const auditLog = new PostgresAuditLog({ pool });
        return new GraphSubscriptionAdminService({
          subscriptionClient: client,
          subscriptionRepository: repository,
          auditLog,
          telemetry,
          allowedNotificationUrlPrefix: process.env.GRAPH_WEBHOOK_CALLBACK_URL,
        });
      },
      inject: ['SECRETS_PROVIDER', 'TELEMETRY'],
    },
  ],
})
export class AdminModule {}
