import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import type { OutreachChannel } from '@projectx/domain';
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
import { ApprovalVerificationAdapter, InMemoryApprovalRepository, PostgresApprovalRepository } from '@projectx/mission-orchestrator';
import { HistoricalRecipientFingerprint, OutboundRecipientRecovery } from '@projectx/application';
import type { IOutputValidator, IReasoningEngine } from '@projectx/ai-runtime';
import {
  AzureKeyVaultSecretsProvider,
  ConsoleTelemetry,
  EnvironmentSecretsProvider,
  InMemoryAuditLog,
  InMemoryIdempotencyStore,
  InMemoryRateLimiter,
  loadControlledCommunicationConfig,
  MsalTokenProvider,
  NoOpTelemetry,
  OpenTelemetryAdapter,
  PostgresAuditLog,
  PostgresIdempotencyStore,
  RedisCache,
  RedisConnectionManager,
  RedisRateLimiter,
  registerOpenTelemetry,
  shutdownOpenTelemetry,
  validateControlledCommunicationConfig,
} from '@projectx/infrastructure';
import type { ISecretsProvider } from '@projectx/infrastructure';
import type { IAuditLog, ICache, IRateLimiter, ITelemetry } from '@projectx/infrastructure';
import {
  FetchGraphHttpClient,
  GraphEmailProvider,
  InMemoryCampaignRepository,
  InMemoryMessageExecutionRepository,
  InMemoryOutreachProviderRegistry,
  InMemoryRecipientAllowlistRepository,
  InMemorySequenceRepository,
  InMemorySequenceSchedulePolicy,
  InMemorySuppressionRepository,
  OutreachExecutionService,
  OutreachPersonalizationService,
  PostgresCampaignRepository,
  PostgresMessageExecutionRepository,
  PostgresRecipientAllowlistRepository,
  PostgresSequenceRepository,
  PostgresSuppressionRepository,
  SendSafetyGate,
  StubEmailProvider,
} from '@projectx/outreach';
import { asEventId, asIdempotencyKey, asOutreachMessageId } from '@projectx/shared';

export function createTelemetry(): ITelemetry {
  const mode = process.env.TELEMETRY_MODE ?? 'console';
  if (mode === 'opentelemetry') {
    registerOpenTelemetry({ serviceName: 'temporal-worker' });
    return new OpenTelemetryAdapter({ serviceName: 'temporal-worker' });
  }
  if (mode === 'noop') return new NoOpTelemetry();
  return new ConsoleTelemetry({ serviceName: 'temporal-worker' });
}

export interface DurableAdapters {
  readonly pool?: Pool;
  readonly cache?: ICache;
  readonly rateLimiter: IRateLimiter;
  readonly auditLog: IAuditLog;
  readonly redisManager?: RedisConnectionManager;
  readonly secretsProvider: ISecretsProvider;
  dispose(): Promise<void>;
}

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

export async function createDurableAdapters(): Promise<DurableAdapters> {
  const config = loadControlledCommunicationConfig();
  validateControlledCommunicationConfig(config);
  const secretsProvider = createSecretsProvider(process.env.AZURE_KEY_VAULT_URL);

  if (!config.databaseUrl) {
    const dispose = async (): Promise<void> => {};
    return {
      rateLimiter: new InMemoryRateLimiter(),
      auditLog: new InMemoryAuditLog(),
      secretsProvider,
      dispose,
    };
  }

  const pool = new Pool({ connectionString: config.databaseUrl });
  const auditLog = new PostgresAuditLog({ pool });

  let rateLimiter: IRateLimiter = new InMemoryRateLimiter();
  if (config.redisUrl) {
    const redisManager = new RedisConnectionManager({ url: config.redisUrl });
    await redisManager.connect();
    const cache = new RedisCache(redisManager.getClient());
    rateLimiter = new RedisRateLimiter(redisManager.getClient());
    const dispose = async (): Promise<void> => {
      await redisManager.quit();
      await pool.end();
      await shutdownOpenTelemetry();
    };
    return { pool, cache, rateLimiter, auditLog, redisManager, secretsProvider, dispose };
  }

  const dispose = async (): Promise<void> => {
    await pool.end();
    await shutdownOpenTelemetry();
  };
  return { pool, rateLimiter, auditLog, secretsProvider, dispose };
}

export function createConversationHandlingService(adapters: DurableAdapters) {
  return new ConversationHandlingService({
    conversationRepository: adapters.pool
      ? new PostgresConversationRepository({ pool: adapters.pool })
      : new InMemoryConversationRepository(),
    leadRepository: adapters.pool
      ? new PostgresLeadRepository({ pool: adapters.pool })
      : new InMemoryLeadRepository(),
    intentClassifier: new DeterministicIntentClassifier(),
    nextBestActionPolicy: new InMemoryNextBestActionPolicy(),
    piiScrubber: adapters.pool ? new RegexPIIScrubber() : new NoOpPIIScrubber(),
    generateConversationId: () => randomUUID(),
    generateReplyMessageId: () => randomUUID(),
    generateEventId: () => asEventId(randomUUID()),
  });
}

export async function createOutreachExecutionService(
  adapters: DurableAdapters,
  telemetry: ITelemetry,
  personalization: { reasoningEngine: IReasoningEngine; outputValidator: IOutputValidator },
) {
  const config = loadControlledCommunicationConfig();
  const useDurable = adapters.pool !== undefined;

  const campaignRepo = useDurable
    ? new PostgresCampaignRepository({ pool: adapters.pool! })
    : new InMemoryCampaignRepository();
  const sequenceRepo = useDurable
    ? new PostgresSequenceRepository({ pool: adapters.pool! })
    : new InMemorySequenceRepository();
  const executionRepo = useDurable
    ? new PostgresMessageExecutionRepository({ pool: adapters.pool! })
    : new InMemoryMessageExecutionRepository();
  const suppressionRepository = useDurable
    ? new PostgresSuppressionRepository({ pool: adapters.pool! })
    : new InMemorySuppressionRepository();
  const allowlistRepository = useDurable
    ? new PostgresRecipientAllowlistRepository({ pool: adapters.pool! })
    : new InMemoryRecipientAllowlistRepository();
  const approvalRepository = useDurable
    ? new PostgresApprovalRepository({ pool: adapters.pool! })
    : new InMemoryApprovalRepository();

  const idempotencyStore = useDurable
    ? new PostgresIdempotencyStore({ pool: adapters.pool! })
    : new InMemoryIdempotencyStore();

  const registry = new InMemoryOutreachProviderRegistry();
  const schedulePolicy = new InMemorySequenceSchedulePolicy();

  if (useDurable) {
    const secrets = createSecretsProvider(config.azureKeyVaultUrl);
    const graphTenantId = process.env.GRAPH_TENANT_ID ?? '';
    const graphClientId = process.env.GRAPH_CLIENT_ID ?? '';
    const graphClientSecret =
      (await resolveSecretValue(secrets, config.graphClientSecret, config.graphClientSecretReference)) ?? '';
    const senderAddress = process.env.GRAPH_SENDER_ADDRESS ?? '';
    const tokenProvider = new MsalTokenProvider({
      tenantId: graphTenantId,
      clientId: graphClientId,
      clientSecret: graphClientSecret,
    });
    const httpClient = new FetchGraphHttpClient();
    const graphProvider = new GraphEmailProvider({ tokenProvider, httpClient, senderAddress });
    registry.register(graphProvider);
    console.info(
      JSON.stringify({
        level: 'info',
        code: 'OUTREACH_PROVIDER_REGISTERED',
        providerId: graphProvider.providerId,
        channel: graphProvider.channel,
        senderAddress,
        timestamp: new Date().toISOString(),
      }),
    );

    // Load explicit tenant → channel → provider mappings from the authoritative
    // configuration table. Without a mapping the registry returns null and
    // executeApprovedSend fails closed (no accidental global fallback).
    const configRows = await adapters.pool!.query(
      'SELECT tenant_id, provider_id, channel FROM outreach.tenant_email_config',
    );
    console.info(
      JSON.stringify({
        level: 'info',
        code: 'TENANT_PROVIDER_CONFIG_LOADED',
        rowCount: configRows.rowCount,
        timestamp: new Date().toISOString(),
      }),
    );
    for (const row of configRows.rows) {
      registry.setTenantProvider(row.tenant_id as string, row.channel as OutreachChannel, row.provider_id as string);
      console.info(
        JSON.stringify({
          level: 'info',
          code: 'TENANT_PROVIDER_MAPPING_SET',
          tenantId: row.tenant_id as string,
          channel: row.channel as string,
          providerId: row.provider_id as string,
          timestamp: new Date().toISOString(),
        }),
      );
    }
  } else {
    const stubProvider = new StubEmailProvider({ type: 'success', costUsd: 0.05 });
    registry.register(stubProvider);
    console.info(
      JSON.stringify({
        level: 'info',
        code: 'OUTREACH_PROVIDER_REGISTERED',
        providerId: stubProvider.providerId,
        channel: stubProvider.channel,
        timestamp: new Date().toISOString(),
      }),
    );
    console.info(
      JSON.stringify({
        level: 'info',
        code: 'TENANT_PROVIDER_CONFIG_LOADED',
        rowCount: 0,
        note: 'stub mode - no tenant DB mappings loaded',
        timestamp: new Date().toISOString(),
      }),
    );
  }

  const personalizationService = new OutreachPersonalizationService({
    reasoningEngine: personalization.reasoningEngine,
    outputValidator: personalization.outputValidator,
    generateMessageId: () => asOutreachMessageId(randomUUID()),
    generateExecutionId: () => `exec-${Date.now()}`,
    generateIdempotencyKey: (hint) => asIdempotencyKey(`idmp-${hint}-${Date.now()}`),
  });

  // Phase 14 Milestone 7b/8 safety boundary. All policy enforcement (allowlist,
  // first-send approval, suppression, rate limiting, budget, atomic idempotency,
  // durable audit) is backed by Postgres/Redis when DATABASE_URL is present.
  // The email provider is GraphEmailProvider in durable mode; the kill-switch
  // OUTREACH_LIVE_EMAIL_ENABLED remains the final gate before any external send.
  const safetyGate = new SendSafetyGate({
    allowlistRepository,
    suppressionRepository,
    approvalVerificationPort: new ApprovalVerificationAdapter(approvalRepository),
    rateLimiter: adapters.rateLimiter,
    idempotencyStore,
    auditLog: adapters.auditLog,
  });

  const executionService = new OutreachExecutionService({
    campaignRepository: campaignRepo,
    sequenceRepository: sequenceRepo,
    executionRepository: executionRepo,
    providerRegistry: registry,
    schedulePolicy,
    personalizationService,
    safetyGate,
    idempotencyStore,
    recipientRecovery: new OutboundRecipientRecovery(adapters.secretsProvider),
    historicalRecipientFingerprint: new HistoricalRecipientFingerprint(adapters.secretsProvider),
    generateExecutionId: () => `exec-${Date.now()}`,
    generateEventId: () => asEventId(`evt-${Date.now()}`),
    channelCostEstimate: () => 0.05,
  });

  console.info(
    JSON.stringify({
      level: 'info',
      code: 'OUTREACH_PROVIDER_REGISTRY_READY',
      providerCount: registry.getProviderCount(),
      tenantMappingCount: registry.getTenantMappingCount(),
      useDurable,
      timestamp: new Date().toISOString(),
    }),
  );

  return { executionService, executionRepo, suppressionRepository, sequenceRepo, providerRegistry: registry, idempotencyStore, adapters };
}
