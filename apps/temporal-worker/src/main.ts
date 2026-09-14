import { createServer, type Server } from 'http';
import { NativeConnection, Worker } from '@temporalio/worker';
import { MissionWorkflow } from './workflows/mission-workflow';
import { OutreachSequenceWorkflow } from './workflows/outreach-sequence-workflow';
import * as activities from './activities';
import {
  setOutreachExecutionService,
  setConversationHandlingService,
  setSuppressionRepository,
  setMessageExecutionRepository,
  setSequenceRepository,
} from './activities/outreach-activities';
import {
  createConversationHandlingService,
  createDurableAdapters,
  createOutreachExecutionService,
  createTelemetry,
} from './outreach-execution-service.factory';
import {
  HealthProbe,
  PostgresHealthIndicator,
  ProcessLifecycle,
  RedisHealthIndicator,
  SecretReadinessIndicator,
} from '@projectx/infrastructure';
import { validateEmbeddingRuntime } from './embedding-runtime';
import { TemporalConnectionState, TemporalHealthIndicator } from './health/temporal-health';

const DEFAULT_HEALTH_PORT = Number(process.env.OUTREACH_WORKER_HEALTH_PORT ?? 3001);
const MAX_TEMPORAL_DELAY_MS = 30_000;
const BASE_TEMPORAL_DELAY_MS = 1_000;

async function connectWithRetry(
  address: string,
  apiKey: string | undefined,
  state: TemporalConnectionState,
  maxAttempts = Infinity,
  initialDelayMs = BASE_TEMPORAL_DELAY_MS,
): Promise<NativeConnection> {
  let delayMs = initialDelayMs;
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      const connection = await NativeConnection.connect({
        address,
        ...(apiKey ? { apiKey, tls: true } : {}),
      });
      state.connected = true;
      return connection;
    } catch (err) {
      state.connected = false;
      if (maxAttempts !== Infinity && attempt >= maxAttempts) {
        throw err;
      }
      const capped = Math.min(delayMs, MAX_TEMPORAL_DELAY_MS);
      const wait = Math.max(1, Math.floor(Math.random() * capped));
      console.warn(
        JSON.stringify({
          level: 'warn',
          code: 'TEMPORAL_CONNECT_RETRY',
          attempt,
          delayMs: capped,
          wait,
          error: err instanceof Error ? err.message : 'unknown',
        }),
      );
      await new Promise((resolve) => {
        const t = setTimeout(resolve, wait);
        t.unref?.();
      });
      delayMs = Math.min(delayMs * 2, MAX_TEMPORAL_DELAY_MS);
    }
  }
}

const workers: Worker[] = [];
const temporalState: TemporalConnectionState = { connected: false };

function assertControlledSendMode(useDurable: boolean): void {
  const liveEmailEnabled = process.env.OUTREACH_LIVE_EMAIL_ENABLED === 'true';
  if (!liveEmailEnabled) {
    return;
  }
  const mode = process.env.OUTREACH_MODE;
  if (mode !== 'ALLOWLIST_ONLY') {
    throw new Error(
      `OUTREACH_MODE must be 'ALLOWLIST_ONLY' when live email is enabled, got: ${mode ?? 'undefined'}. See ADR-129.`,
    );
  }
  if (!useDurable) {
    throw new Error(
      `Live email requires durable Postgres repositories, but DATABASE_URL is not configured. See ADR-129.`,
    );
  }
}

async function runMissionWorker(connection: NativeConnection): Promise<void> {
  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    workflowsPath: require.resolve('./workflows/mission-workflow'),
    taskQueue: 'mission-execution',
    activities,
  });
  workers.push(worker);
  console.log(JSON.stringify({ level: 'info', code: 'TEMPORAL_WORKER_LISTENING', taskQueue: 'mission-execution' }));
  await worker.run();
}

async function runKnowledgeWorker(connection: NativeConnection): Promise<void> {
  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    workflowsPath: require.resolve('./workflows/knowledge-ingestion-workflow'),
    taskQueue: 'knowledge-ingestion',
    activities,
  });
  workers.push(worker);
  console.log(JSON.stringify({ level: 'info', code: 'TEMPORAL_WORKER_LISTENING', taskQueue: 'knowledge-ingestion' }));
  await worker.run();
}

async function runOutreachWorker(connection: NativeConnection): Promise<void> {
  const telemetry = createTelemetry();
  const adapters = await createDurableAdapters();
  const { executionService, executionRepo, suppressionRepository, sequenceRepo } = await createOutreachExecutionService(
    adapters,
    telemetry,
    { reasoningEngine: activities.productionReasoningEngine, outputValidator: activities.productionOutputValidator },
  );
  assertControlledSendMode(adapters.pool !== undefined);
  setOutreachExecutionService(executionService);
  setConversationHandlingService(createConversationHandlingService(adapters));
  setSuppressionRepository(suppressionRepository);
  setMessageExecutionRepository(executionRepo);
  setSequenceRepository(sequenceRepo);
  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    workflowsPath: require.resolve('./workflows/outreach-sequence-workflow'),
    taskQueue: 'outreach-execution',
    activities: require('./activities/outreach-activities'),
  });
  workers.push(worker);
  console.log(JSON.stringify({ level: 'info', code: 'TEMPORAL_WORKER_LISTENING', taskQueue: 'outreach-execution' }));
  await worker.run();
}

function createHealthServer(healthProbe: HealthProbe): Server {
  return createServer(async (req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (req.url === '/readyz') {
      const report = await healthProbe.checkAll();
      const statusCode = report.healthy ? 200 : 503;
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(report));
      return;
    }
    res.writeHead(404).end();
  });
}

async function main(): Promise<void> {
  const healthProbe = new HealthProbe();
  const adapters = await createDurableAdapters();

  // Validate exactly one ACTIVE embedding profile and a matching real provider
  // before any worker can accept a mission. Fail closed on mismatch or missing secret.
  await validateEmbeddingRuntime('production', adapters.secretsProvider);

  healthProbe.add(new SecretReadinessIndicator({ name: 'secrets' }));
  if (adapters.pool) {
    healthProbe.add(new PostgresHealthIndicator({ pool: adapters.pool, name: 'postgres' }));
  }
  if (adapters.redisManager) {
    healthProbe.add(new RedisHealthIndicator({ manager: adapters.redisManager, name: 'redis' }));
  }
  healthProbe.add(new TemporalHealthIndicator({ state: temporalState, name: 'temporal' }));

  const healthServer = createHealthServer(healthProbe);
  healthServer.listen(DEFAULT_HEALTH_PORT, () => {
    console.log(JSON.stringify({ level: 'info', code: 'HEALTH_SERVER_LISTENING', port: DEFAULT_HEALTH_PORT }));
  });

  const lifecycle = new ProcessLifecycle({
    healthProbe,
    drainTimeoutMs: Number(process.env.OUTREACH_GRACEFUL_DRAIN_MS ?? 30_000),
  });
  lifecycle.addShutdownable({
    shutdown: async () => {
      await adapters.dispose();
    },
  });
  lifecycle.addShutdownable({
    shutdown: async () => {
      await Promise.all(workers.map((w) => w.shutdown()));
    },
  });
  lifecycle.addShutdownable({
    shutdown: async () => {
      await new Promise<void>((resolve) => healthServer.close(() => resolve()));
    },
  });
  lifecycle.start();

  const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
  const apiKey = process.env.TEMPORAL_API_KEY;

  // Keep the process alive and report readiness while reconnecting. If the
  // connection drops at runtime, shut the workers down and reconnect with
  // bounded exponential backoff + jitter.
  while (true) {
    const connection = await connectWithRetry(address, apiKey, temporalState);
    console.log(JSON.stringify({ level: 'info', code: 'TEMPORAL_CONNECTED', address }));
    try {
      await Promise.all([runMissionWorker(connection), runKnowledgeWorker(connection), runOutreachWorker(connection)]);
    } catch (err) {
      temporalState.connected = false;
      console.warn(
        JSON.stringify({
          level: 'warn',
          code: 'TEMPORAL_WORKER_LOST',
          error: err instanceof Error ? err.message : 'unknown',
        }),
      );
    } finally {
      await Promise.allSettled(workers.map((w) => w.shutdown()));
      workers.length = 0;
      await connection.close().catch(() => {});
      temporalState.connected = false;
      await new Promise((resolve) => {
        const t = setTimeout(resolve, BASE_TEMPORAL_DELAY_MS);
        t.unref?.();
      });
    }
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'error', code: 'TEMPORAL_WORKER_FAILED', error: err instanceof Error ? err.message : 'unknown' }));
  process.exit(1);
});
