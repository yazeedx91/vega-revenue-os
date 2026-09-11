import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import {
  InMemoryIdempotencyStore,
  InMemoryAuditLog,
  ConsoleTelemetry,
  MsalTokenProvider,
  NoOpTelemetry,
  OpenTelemetryAdapter,
  PostgresAuditLog,
  PostgresIdempotencyStore,
  AzureKeyVaultSecretsProvider,
  EnvironmentSecretsProvider,
  loadControlledCommunicationConfig,
  validateControlledCommunicationConfig,
} from '@projectx/infrastructure';
import type { IAuditLog, ISecretsProvider, ITelemetry } from '@projectx/infrastructure';
import {
  ConversationHandlingService,
  DeterministicIntentClassifier,
  InMemoryConversationRepository,
  InMemoryLeadRepository,
  InMemoryNextBestActionPolicy,
  NoOpPIIScrubber,
  PostgresConversationRepository,
  PostgresLeadRepository,
  RegexPIIScrubber,
} from '@projectx/conversation';
import {
  FakeTemporalSignalDispatcher,
  FetchGraphInboundMessageFetcher,
  GraphInboundIngressService,
  GraphMessageNormalizer,
  GraphReplyCorrelator,
  GraphTenantResolver,
  GraphWebhookValidator,
  InMemoryGraphSubscriptionRepository,
  InMemoryMessageExecutionRepository,
  InMemorySuppressionRepository,
  InMemoryTenantEmailConfigRepository,
  PostgresGraphSubscriptionRepository,
  PostgresMessageExecutionRepository,
  PostgresSuppressionRepository,
  PostgresTenantEmailConfigRepository,
  StubGraphInboundMessageFetcher,
} from '@projectx/outreach';
import { HistoricalRecipientFingerprint } from '@projectx/application';
import { TemporalSignalDispatcher } from '@projectx/temporal-client';
import { randomUUID } from 'crypto';
import { GraphEmailWebhookController } from './graph-email-webhook.controller';
import { GraphInboundOrchestratorService } from './graph-inbound-orchestrator.service';

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function createSecretsProvider(vaultUrl?: string): ISecretsProvider {
  if (vaultUrl) {
    return new AzureKeyVaultSecretsProvider({ vaultUrl });
  }
  if (isProduction()) {
    throw new Error('AZURE_KEY_VAULT_URL is required in production; EnvironmentSecretsProvider is not allowed');
  }
  return new EnvironmentSecretsProvider();
}

async function resolveSecretValue(
  secrets: ISecretsProvider,
  envValue: string | undefined,
  secretReference: string | undefined,
): Promise<string | undefined> {
  if (isProduction() && envValue) {
    throw new Error('Raw *_SECRET values are not allowed in production; use *_SECRET_REFERENCE');
  }
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

function createTelemetry(): ITelemetry {
  const mode = process.env.TELEMETRY_MODE ?? 'console';
  if (mode === 'opentelemetry') return new OpenTelemetryAdapter({ serviceName: 'projectx-api-graph-inbound' });
  if (mode === 'noop') return new NoOpTelemetry();
  return new ConsoleTelemetry({ serviceName: 'projectx-api-graph-inbound' });
}

/**
 * Phase 14 Milestone 7b composition root for the Graph inbound webhook path.
 *
 * Persistence and audit are backed by Postgres when DATABASE_URL is present;
 * in-memory doubles remain available for deterministic unit tests and local
 * development without a database. The Temporal signal dispatcher is selectable
 * at runtime: if `TEMPORAL_ADDRESS` is provided, the real
 * `@temporalio/client`-backed `TemporalSignalDispatcher` is used; otherwise
 * the in-process `FakeTemporalSignalDispatcher` is used.
 */
@Module({
  controllers: [GraphEmailWebhookController],
  providers: [
    {
      provide: GraphInboundOrchestratorService,
      useFactory: async () => {
        const config = loadControlledCommunicationConfig();
        validateControlledCommunicationConfig(config);

        const telemetry = createTelemetry();
        const databaseUrl = config.databaseUrl;
        const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : undefined;

        const suppressionRepository = pool
          ? new PostgresSuppressionRepository({ pool })
          : new InMemorySuppressionRepository();
        const messageExecutionRepository = pool
          ? new PostgresMessageExecutionRepository({ pool })
          : new InMemoryMessageExecutionRepository();
        const tenantEmailConfigRepository = pool
          ? new PostgresTenantEmailConfigRepository({ pool })
          : new InMemoryTenantEmailConfigRepository();

        const secrets = createSecretsProvider(config.azureKeyVaultUrl);

        const messageFetcher = pool
          ? new FetchGraphInboundMessageFetcher({
              tokenProvider: new MsalTokenProvider({
                tenantId: config.graphTenantId ?? '',
                clientId: config.graphClientId ?? '',
                clientSecret:
                  (await resolveSecretValue(
                    secrets,
                    config.graphClientSecret,
                    config.graphClientSecretReference,
                  )) ?? '',
              }),
            })
          : new StubGraphInboundMessageFetcher();

        const subscriptionRepository = pool
          ? new PostgresGraphSubscriptionRepository({ pool })
          : new InMemoryGraphSubscriptionRepository();

        const ingressService = new GraphInboundIngressService({
          validator: new GraphWebhookValidator({ secretsProvider: secrets }),
          tenantResolver: new GraphTenantResolver(tenantEmailConfigRepository),
          subscriptionRepository,
          messageFetcher,
          normalizer: new GraphMessageNormalizer(),
          correlator: new GraphReplyCorrelator({
            messageExecutionRepository,
            historicalRecipientFingerprint: new HistoricalRecipientFingerprint(secrets),
          }),
          idempotencyStore: pool
            ? new PostgresIdempotencyStore({ pool })
            : new InMemoryIdempotencyStore(),
        });

        const conversationService = new ConversationHandlingService({
          conversationRepository: pool
            ? new PostgresConversationRepository({ pool })
            : new InMemoryConversationRepository(),
          leadRepository: pool
            ? new PostgresLeadRepository({ pool })
            : new InMemoryLeadRepository(),
          intentClassifier: new DeterministicIntentClassifier(),
          nextBestActionPolicy: new InMemoryNextBestActionPolicy(),
          piiScrubber: pool ? new RegexPIIScrubber() : new NoOpPIIScrubber(),
          generateConversationId: () => randomUUID(),
          generateReplyMessageId: () => randomUUID(),
          generateEventId: () => randomUUID(),
        });

        const signalDispatcher = process.env.TEMPORAL_ADDRESS
          ? new TemporalSignalDispatcher({
              address: process.env.TEMPORAL_ADDRESS,
              namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
            })
          : new FakeTemporalSignalDispatcher();

        const auditLog: IAuditLog = pool
          ? new PostgresAuditLog({ pool })
          : new InMemoryAuditLog();

        return new GraphInboundOrchestratorService({
          ingressService,
          conversationService,
          suppressionRepository,
          messageExecutionRepository,
          signalDispatcher,
          auditLog,
          telemetry,
        });
      },
    },
  ],
})
export class GraphInboundModule {}
