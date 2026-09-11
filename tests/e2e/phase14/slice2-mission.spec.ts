import { createConnection } from 'net';
import type { AddressInfo } from 'net';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { Connection, WorkflowClient } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import { Actor } from '@projectx/domain';
import { CreateMissionHandler, type CommandContext } from '@projectx/application';
import {
  InMemoryIdempotencyStore,
  MissionOrchestratorService,
  PostgresMissionRepository,
} from '@projectx/mission-orchestrator';
import { TemporalWorkflowClient } from '@projectx/temporal-client';
import {
  asCorrelationId,
  asEventId,
  asIdempotencyKey,
  asMissionId,
  asTenantId,
  asUserId,
} from '@projectx/shared';
import { statusQuery } from '../../../apps/temporal-worker/src/workflows/mission-workflow';
import type { MissionWorkflowStatus } from '@projectx/mission-orchestrator';
import {
  getAdminDatabaseUrl,
  getAppDatabaseUrl,
  getTemporalAddress,
} from './integration-config';
import {
  connectPostgres,
  requireEnv,
  runMigrations,
} from './helpers';

const INITIAL_PLAN = {
  planId: '',
  version: 0,
  objectives: [],
  phases: [],
  approvalGates: [],
  fallbackBranches: [],
};

// Slice 5 wired the real ProductionReasoningEngine into the shared worker, so a
// mission now invokes a real LLM provider. Point the provider adapters at a
// local HTTP mock so the reasoning step completes deterministically.
const VALID_REASONING = JSON.stringify({
  rationale: 'Slice 2 rationale.',
  conclusion: 'Proceed with research task.',
  confidence: 0.9,
  evidence: ['evidence-1'],
  requiredApprovals: [],
  proposedActions: [],
  assumptions: [],
});

class MockLLMServer {
  private server!: Server;
  public baseUrl = '';

  async start(): Promise<void> {
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    const { port } = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = req.url ?? '';
      if (url.includes('/v1/chat/completions')) {
        this.reply(res, 'openai');
      } else if (url.includes('/v1/messages')) {
        this.reply(res, 'anthropic');
      } else {
        res.writeHead(404).end('not found');
      }
    });
  }

  private reply(res: ServerResponse, provider: 'openai' | 'anthropic'): void {
    const payload =
      provider === 'openai'
        ? {
            id: `chatcmpl-${randomUUID()}`,
            choices: [
              { message: { role: 'assistant', content: VALID_REASONING }, finish_reason: 'stop' },
            ],
            usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 },
          }
        : {
            id: `msg-${randomUUID()}`,
            content: [{ type: 'text', text: VALID_REASONING }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 12, output_tokens: 34 },
          };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  }
}

async function isReachable(address: string): Promise<boolean> {
  const [host, portStr] = address.split(':');
  const port = parseInt(portStr ?? '7233', 10);
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let resolved = false;
    const finish = (value: boolean) => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(5000, () => finish(false));
  });
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 60_000,
  intervalMs = 200,
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe('Slice 2 canonical mission E2E', () => {
  let appPool: Pool | undefined;
  let adminPool: Pool | undefined;
  let repo: PostgresMissionRepository | undefined;
  let nativeConnection: NativeConnection | undefined;
  let clientConnection: Connection | undefined;
  let client: WorkflowClient | undefined;
  let mock: MockLLMServer | undefined;
  const address = getTemporalAddress();
  const controlPlaneSeeds = { research: false, agent: false, models: false };

  function buildService(taskQueue: string): MissionOrchestratorService {
    return new MissionOrchestratorService({
      missionRepository: repo!,
      eventBus: { publish: async () => {}, sendCommand: async () => {}, subscribe: async () => {} },
      workflowClient: new TemporalWorkflowClient({ address }),
      idempotencyStore: new InMemoryIdempotencyStore(),
      generateIdempotencyKey: (hint: string) => asIdempotencyKey(`${hint}:${randomUUID()}`),
      generateEventId: () => asEventId(`evt-${randomUUID()}`),
      generateCorrelationId: () => asCorrelationId(`corr-${randomUUID()}`),
      workflowType: 'MissionWorkflow',
      taskQueue,
    });
  }

  function makeCommand(missionId: string, operatorId: string) {
    return {
      id: missionId,
      name: 'Slice 2 Canonical Mission',
      objective: 'End-to-end mission execution through Temporal and Postgres',
      icpId: 'icp-slice2',
      territory: ['US', 'CA'],
      channels: ['email', 'linkedin'],
      budget: { maxAiCostUsd: 1 },
      autonomyLevel: 5,
      constraints: { workingHours: '9-17 UTC' },
      successCriteria: { targetMeetings: 1 },
      ownerUserId: operatorId,
      plan: INITIAL_PLAN,
    };
  }

  async function seedControlPlaneFixtures(adminPool: Pool): Promise<void> {
    const research = await adminPool.query('SELECT 1 FROM control_plane.capabilities WHERE capability_id = $1', ['research']);
    if (research.rowCount === 0) {
      await adminPool.query(
        `INSERT INTO control_plane.capabilities
           (capability_id, name, description, risk_category, allowed_tools, required_policies, version)
         VALUES ($1, $2, $3, $4, $5, $6, '1.0.0')`,
        ['research', 'Research', 'Research capability', 'LOW', [], []],
      );
      controlPlaneSeeds.research = true;
    }

    await adminPool.query(
      `INSERT INTO control_plane.agent_versions
         (version_id, agent_id, tenant_id, is_system, version, lifecycle, name, role, description,
          capabilities, tools, policies, model_policy, memory_policy, knowledge_policy,
          autonomy_level_default, evaluation_policy, owner, implementation_key, created_at, updated_at)
       VALUES ($1, $2, null, true, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), NOW())
       ON CONFLICT (version_id) DO UPDATE SET
         implementation_key = EXCLUDED.implementation_key,
         lifecycle = EXCLUDED.lifecycle,
         capabilities = EXCLUDED.capabilities,
         tools = EXCLUDED.tools,
         policies = EXCLUDED.policies,
         model_policy = EXCLUDED.model_policy,
         memory_policy = EXCLUDED.memory_policy,
         knowledge_policy = EXCLUDED.knowledge_policy,
         autonomy_level_default = EXCLUDED.autonomy_level_default,
         evaluation_policy = EXCLUDED.evaluation_policy,
         updated_at = NOW()`,
      [
        'slice2-e2e:agent-1:1.0.0',
        'agent-1',
        '1.0.0',
        'ACTIVE',
        'Slice 2 Agent',
        'researcher',
        'Stub agent for Slice 2 mission E2E',
        ['research'],
        [],
        JSON.stringify([]),
        JSON.stringify({}),
        JSON.stringify({}),
        JSON.stringify({}),
        5,
        JSON.stringify({}),
        'slice2-e2e',
        'specialist.research.v1',
      ],
    );
    controlPlaneSeeds.agent = true;

    // Models eligible for the 'reasoning' capability, routed to the real providers
    // (which the test points at the local mock via *_BASE_URL env).
    for (const m of [
      { id: 'gpt-4o-mini', provider: 'openai', family: 'gpt', priority: 1 },
      { id: 'claude-3-haiku-20240307', provider: 'anthropic', family: 'claude', priority: 2 },
    ]) {
      await adminPool.query(
        `INSERT INTO control_plane.models
           (model_id, provider, family, capabilities, latency_class, cost_metadata, health_metadata, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (model_id) DO UPDATE SET
           provider = EXCLUDED.provider,
           capabilities = EXCLUDED.capabilities,
           health_metadata = EXCLUDED.health_metadata,
           updated_at = NOW()`,
        [
          m.id,
          m.provider,
          m.family,
          ['reasoning', 'chat'],
          'background',
          JSON.stringify({ costPerInputTokenUsd: 5e-7, costPerOutputTokenUsd: 1.5e-6 }),
          JSON.stringify({ maxContextTokens: 128000, supportsStructuredOutput: true, lifecycle: 'ACTIVE', priority: m.priority }),
        ],
      );
    }
    controlPlaneSeeds.models = true;

    // Guard against a stale Slice 3 system-hard-deny fixture blocking this run.
    await adminPool.query(
      `DELETE FROM control_plane.policies
       WHERE policy_id = 'system-hard-deny' AND is_system = true AND scope = 'system' AND capability = 'research'`,
    );
    // Guard against any stale non-ALLOW system research policy blocking this run.
    await adminPool.query(
      `DELETE FROM control_plane.policies
       WHERE is_system = true AND scope = 'system' AND capability = 'research' AND outcome <> 'ALLOW'`,
    );
  }

  async function seedWorkspace(tenantId: string, workspaceId: string, userId: string): Promise<void> {
    await adminPool!.query('INSERT INTO identity.users(id,email,tenant_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [userId, `${userId}@example.test`, tenantId]);
    await adminPool!.query('INSERT INTO identity.workspaces(id,tenant_id,name,owner_user_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [workspaceId, tenantId, 'Slice 2', userId]);
    await adminPool!.query("INSERT INTO identity.memberships(workspace_id,tenant_id,user_id,role) VALUES($1,$2,$3,'OPERATOR') ON CONFLICT DO NOTHING", [workspaceId, tenantId, userId]);
  }

  async function cleanupControlPlaneFixtures(adminPool: Pool): Promise<void> {
    if (controlPlaneSeeds.agent) {
      await adminPool.query(
        `DELETE FROM control_plane.agent_versions WHERE version_id = $1`,
        ['slice2-e2e:agent-1:1.0.0'],
      );
    }
    if (controlPlaneSeeds.research) {
      await adminPool.query(
        `DELETE FROM control_plane.capabilities WHERE capability_id = $1`,
        ['research'],
      );
    }
  }

  beforeAll(async () => {
    requireEnv();
    if (!(await isReachable(address))) {
      // eslint-disable-next-line no-console
      console.warn(`Skipping Slice 2 mission E2E: Temporal ${address} unreachable`);
      return;
    }

    await runMigrations(getAdminDatabaseUrl());

    // Start the mock and point the real provider adapters at it BEFORE the test
    // imports activities.ts (which reads provider base URLs/secrets at import).
    mock = new MockLLMServer();
    await mock.start();
    process.env.DATABASE_URL = getAppDatabaseUrl();
    process.env.OPENAI_BASE_URL = mock.baseUrl;
    process.env.ANTHROPIC_BASE_URL = mock.baseUrl;
    process.env.OPENAI_API_KEY = 'e2e-openai-key';
    process.env.ANTHROPIC_API_KEY = 'e2e-anthropic-key';

    [appPool, adminPool] = await Promise.all([
      connectPostgres(getAppDatabaseUrl()),
      connectPostgres(getAdminDatabaseUrl()),
    ]);
    repo = new PostgresMissionRepository({ pool: appPool });

    await seedControlPlaneFixtures(adminPool!);

    nativeConnection = await NativeConnection.connect({ address });
    clientConnection = await Connection.connect({ address });
    client = new WorkflowClient({ connection: clientConnection });
  }, 120_000);

  beforeEach(async () => {
    if (!adminPool) return;
    await adminPool.query(
      `TRUNCATE TABLE mission.missions, mission.plans, mission.tasks, mission.task_dependencies, mission.task_execution_state, mission.observations, mission.workflow_identity CASCADE`,
    );
  }, 30_000);

  afterAll(async () => {
    if (mock) await mock.stop();
    if (adminPool) await cleanupControlPlaneFixtures(adminPool);
    await adminPool?.end();
    await appPool?.end();
    await clientConnection?.close();
    await nativeConnection?.close();
  }, 30_000);

  it('creates, starts and completes a mission through the orchestrator, Temporal and Postgres', async () => {
    if (!nativeConnection || !client || !repo) return;

    const runId = Date.now();
    const tenantId = asTenantId(`tenant-slice2-${runId}`);
    const missionId = asMissionId(randomUUID());
    const correlationId = asCorrelationId(`corr-slice2-${runId}`);
    const operatorId = asUserId(randomUUID());
    const workspaceId = randomUUID();
    await seedWorkspace(tenantId, workspaceId, operatorId);
    const ctx = {
      tenantId,
      workspaceId,
      actor: Actor.human(operatorId, tenantId),
      correlationId,
    };

    const command = {
      id: missionId as string,
      name: 'Slice 2 Canonical Mission',
      objective: 'End-to-end mission execution through Temporal and Postgres',
      icpId: 'icp-slice2',
      territory: ['US', 'CA'],
      channels: ['email', 'linkedin'],
      budget: { maxAiCostUsd: 1 },
      autonomyLevel: 5,
      constraints: { workingHours: '9-17 UTC' },
      successCriteria: { targetMeetings: 1 },
      ownerUserId: operatorId,
      plan: INITIAL_PLAN,
    };

    const handler = new CreateMissionHandler(repo);
    const createResult = await handler.execute(ctx, command);
    if (!createResult.success) throw new Error(createResult.error.message);

    const mission = createResult.value.value;
    const approveResult = mission.approve(
      ctx.actor,
      asCorrelationId(`corr-slice2-approve-${runId}`),
      asEventId(`evt-slice2-approve-${runId}`),
    );
    if (!approveResult.success) throw new Error(approveResult.error.message);
    await repo.save(ctx, mission);

    const taskQueue = `mission-slice2-${runId}`;
    const activities = await import('../../../apps/temporal-worker/src/activities');

    const worker = await Worker.create({
      connection: nativeConnection,
      taskQueue,
      workflowsPath: require.resolve('../../../apps/temporal-worker/src/workflows/mission-workflow'),
      activities,
    });
    const workerRun = worker.run().catch(() => {});

    try {
      const service = new MissionOrchestratorService({
        missionRepository: repo,
        eventBus: { publish: async () => {}, sendCommand: async () => {}, subscribe: async () => {} },
        workflowClient: new TemporalWorkflowClient({ address }),
        idempotencyStore: new InMemoryIdempotencyStore(),
        generateIdempotencyKey: (hint: string) => asIdempotencyKey(`${hint}:${randomUUID()}`),
        generateEventId: () => asEventId(`evt-${randomUUID()}`),
        generateCorrelationId: () => asCorrelationId(`corr-${randomUUID()}`),
        workflowType: 'MissionWorkflow',
        taskQueue,
      });

      const startResult = await service.startMission(ctx, { missionId: missionId as string });
      const handle = client.getHandle(startResult.workflowId);

      await waitFor(
        async () => (await handle.query<MissionWorkflowStatus | undefined>(statusQuery))?.status === 'COMPLETED',
        60_000,
      );
      await handle.result();

      const completed = await repo.findById(ctx, missionId as string);
      expect(completed).not.toBeNull();
      expect(completed?.status).toBe('COMPLETED');
      expect(completed?.plan.version).toBeGreaterThan(0);
      expect(completed?.tasks.length).toBeGreaterThan(0);
      expect(completed?.tasks.every((t) => t.status === 'COMPLETED')).toBe(true);
    } finally {
      worker.shutdown();
      await workerRun;
    }
  }, 120_000);

  it('pauses and resumes a mission without progression during the pause', async () => {
    if (!nativeConnection || !client || !repo) return;

    const runId = Date.now();
    const tenantId = asTenantId(`tenant-slice2-pause-${runId}`);
    const missionId = asMissionId(randomUUID());
    const correlationId = asCorrelationId(`corr-slice2-pause-${runId}`);
    const operatorId = asUserId(randomUUID());
    const workspaceId = randomUUID();
    await seedWorkspace(tenantId, workspaceId, operatorId);
    const ctx = {
      tenantId,
      workspaceId,
      actor: Actor.human(operatorId, tenantId),
      correlationId,
    };

    const handler = new CreateMissionHandler(repo);
    const createResult = await handler.execute(ctx, makeCommand(missionId as string, operatorId as string));
    if (!createResult.success) throw new Error(createResult.error.message);

    const mission = createResult.value.value;
    const approveResult = mission.approve(
      ctx.actor,
      asCorrelationId(`corr-slice2-pause-approve-${runId}`),
      asEventId(`evt-slice2-pause-approve-${runId}`),
    );
    if (!approveResult.success) throw new Error(approveResult.error.message);
    await repo.save(ctx, mission);

    const taskQueue = `mission-slice2-pause-${runId}`;
    const activities = await import('../../../apps/temporal-worker/src/activities');

    const worker = await Worker.create({
      connection: nativeConnection,
      taskQueue,
      workflowsPath: require.resolve('../../../apps/temporal-worker/src/workflows/mission-workflow'),
      activities,
    });
    const workerRun = worker.run().catch(() => {});

    try {
      const service = buildService(taskQueue);
      const startResult = await service.startMission(ctx, { missionId: missionId as string });
      const handle = client.getHandle(startResult.workflowId);

      await waitFor(
        async () => (await handle.query<MissionWorkflowStatus | undefined>(statusQuery))?.status === 'EXECUTING',
        60_000,
      );

      await service.pauseMission(ctx, { missionId: missionId as string, reason: 'e2e-pause' });

      await waitFor(
        async () => (await handle.query<MissionWorkflowStatus | undefined>(statusQuery))?.status === 'PAUSED',
        60_000,
      );
      await waitFor(async () => (await repo.findById(ctx, missionId as string))?.status === 'PAUSED', 60_000);

      const prePause = await repo.findById(ctx, missionId as string);
      const prePauseTaskCount = prePause?.tasks.length ?? 0;
      const prePauseCompletedCount =
        prePause?.tasks.filter((t) => t.status === 'COMPLETED').length ?? 0;

      // Hold longer than normal task scheduling latency.
      await new Promise((resolve) => setTimeout(resolve, 2_000));

      const paused = await repo.findById(ctx, missionId as string);
      expect(paused?.status).toBe('PAUSED');
      expect(paused?.tasks.length).toBe(prePauseTaskCount);
      expect(
        paused?.tasks.filter((t) => t.status === 'COMPLETED').length,
      ).toBeLessThanOrEqual(prePauseCompletedCount);
      const pausedWorkflow = await handle.query<MissionWorkflowStatus | undefined>(statusQuery);
      expect(pausedWorkflow?.status).toBe('PAUSED');

      await service.resumeMission(ctx, { missionId: missionId as string });

      await waitFor(
        async () => (await handle.query<MissionWorkflowStatus | undefined>(statusQuery))?.status === 'COMPLETED',
        60_000,
      );
      await handle.result();

      const completed = await repo.findById(ctx, missionId as string);
      expect(completed?.status).toBe('COMPLETED');
      expect(completed?.plan.version).toBe(1);
      expect(completed?.tasks.length).toBeGreaterThan(0);
      expect(completed?.tasks.every((t) => t.status === 'COMPLETED')).toBe(true);
    } finally {
      worker.shutdown();
      await workerRun;
    }
  }, 120_000);

  it('replans a mission deterministically from v1 to v2', async () => {
    if (!nativeConnection || !client || !repo) return;

    const runId = Date.now();
    const tenantId = asTenantId(`tenant-slice2-replan-${runId}`);
    const missionId = asMissionId(randomUUID());
    const correlationId = asCorrelationId(`corr-slice2-replan-${runId}`);
    const operatorId = asUserId(randomUUID());
    const workspaceId = randomUUID();
    await seedWorkspace(tenantId, workspaceId, operatorId);
    const ctx = {
      tenantId,
      workspaceId,
      actor: Actor.human(operatorId, tenantId),
      correlationId,
    };

    const handler = new CreateMissionHandler(repo);
    const createResult = await handler.execute(ctx, makeCommand(missionId as string, operatorId as string));
    if (!createResult.success) throw new Error(createResult.error.message);

    const mission = createResult.value.value;
    const approveResult = mission.approve(
      ctx.actor,
      asCorrelationId(`corr-slice2-replan-approve-${runId}`),
      asEventId(`evt-slice2-replan-approve-${runId}`),
    );
    if (!approveResult.success) throw new Error(approveResult.error.message);
    await repo.save(ctx, mission);

    const taskQueue = `mission-slice2-replan-${runId}`;
    const activities = await import('../../../apps/temporal-worker/src/activities');

    const worker = await Worker.create({
      connection: nativeConnection,
      taskQueue,
      workflowsPath: require.resolve('../../../apps/temporal-worker/src/workflows/mission-workflow'),
      activities,
    });
    const workerRun = worker.run().catch(() => {});

    try {
      const service = buildService(taskQueue);
      const startResult = await service.startMission(ctx, { missionId: missionId as string });

      // Replan is issued before any task executes so the workflow upgrades from v1 to v2.
      await service.replanMission(ctx, { missionId: missionId as string });

      const handle = client.getHandle(startResult.workflowId);
      await waitFor(
        async () => (await handle.query<MissionWorkflowStatus | undefined>(statusQuery))?.status === 'COMPLETED',
        60_000,
      );
      await handle.result();

      const completed = await repo.findById(ctx, missionId as string);
      expect(completed).not.toBeNull();
      expect(completed?.status).toBe('COMPLETED');
      expect(completed?.plan.version).toBe(2);
      expect(completed?.tasks.length).toBeGreaterThan(0);
      expect(completed?.tasks.every((t) => t.status === 'COMPLETED')).toBe(true);
    } finally {
      worker.shutdown();
      await workerRun;
    }
  }, 120_000);

  it('cancels a mission to CANCELLED with no further progression', async () => {
    if (!nativeConnection || !client || !repo) return;

    const runId = Date.now();
    const tenantId = asTenantId(`tenant-slice2-cancel-${runId}`);
    const missionId = asMissionId(randomUUID());
    const correlationId = asCorrelationId(`corr-slice2-cancel-${runId}`);
    const operatorId = asUserId(randomUUID());
    const workspaceId = randomUUID();
    await seedWorkspace(tenantId, workspaceId, operatorId);
    const ctx = {
      tenantId,
      workspaceId,
      actor: Actor.human(operatorId, tenantId),
      correlationId,
    };

    const handler = new CreateMissionHandler(repo);
    const createResult = await handler.execute(ctx, makeCommand(missionId as string, operatorId as string));
    if (!createResult.success) throw new Error(createResult.error.message);

    const mission = createResult.value.value;
    const approveResult = mission.approve(
      ctx.actor,
      asCorrelationId(`corr-slice2-cancel-approve-${runId}`),
      asEventId(`evt-slice2-cancel-approve-${runId}`),
    );
    if (!approveResult.success) throw new Error(approveResult.error.message);
    await repo.save(ctx, mission);

    const taskQueue = `mission-slice2-cancel-${runId}`;
    const activities = await import('../../../apps/temporal-worker/src/activities');

    const worker = await Worker.create({
      connection: nativeConnection,
      taskQueue,
      workflowsPath: require.resolve('../../../apps/temporal-worker/src/workflows/mission-workflow'),
      activities: { ...activities, executeMissionStepActivity: async () => ({ missionId: missionId as string, status: 'EXECUTING' }) },
    });
    const workerRun = worker.run().catch(() => {});

    try {
      const service = buildService(taskQueue);
      const startResult = await service.startMission(ctx, { missionId: missionId as string });
      const handle = client.getHandle(startResult.workflowId);

      await waitFor(
        async () => (await handle.query<MissionWorkflowStatus | undefined>(statusQuery))?.status === 'EXECUTING',
        60_000,
      );

      await service.cancelMission(ctx, { missionId: missionId as string, reason: 'e2e-cancel' });

      await waitFor(
        async () => (await handle.query<MissionWorkflowStatus | undefined>(statusQuery))?.status === 'CANCELLED',
        60_000,
      );
      await handle.result();

      const cancelled = await repo.findById(ctx, missionId as string);
      expect(cancelled?.status).toBe('CANCELLED');
      const cancelledTaskCount = cancelled?.tasks.length ?? 0;
      const cancelledCompletedCount =
        cancelled?.tasks.filter((t) => t.status === 'COMPLETED').length ?? 0;

      await new Promise((resolve) => setTimeout(resolve, 2_000));

      const stillCancelled = await repo.findById(ctx, missionId as string);
      expect(stillCancelled?.status).toBe('CANCELLED');
      expect(stillCancelled?.tasks.length).toBe(cancelledTaskCount);
      expect(
        stillCancelled?.tasks.filter((t) => t.status === 'COMPLETED').length,
      ).toBeLessThanOrEqual(cancelledCompletedCount);
    } finally {
      worker.shutdown();
      await workerRun;
    }
  }, 120_000);
});
