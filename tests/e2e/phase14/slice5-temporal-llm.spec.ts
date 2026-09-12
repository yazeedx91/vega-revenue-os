import { createConnection } from 'net';
import { randomUUID } from 'crypto';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
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
import { PostgresInvocationAccounting, buildVectorSpace } from '@projectx/ai-runtime';
import { validateEmbeddingRuntime } from '../../../apps/temporal-worker/src/embedding-runtime';
import { TemporalWorkflowClient } from '@projectx/temporal-client';
import { PostgresClient } from '@projectx/infrastructure';
import {
  asCorrelationId,
  asEventId,
  asIdempotencyKey,
  asMissionId,
  asTenantId,
  asUserId,
} from '@projectx/shared';
import type { TenantContext } from '@projectx/domain';
import type { MissionWorkflowStatus } from '@projectx/mission-orchestrator';
import { statusQuery } from '../../../apps/temporal-worker/src/workflows/mission-workflow';
import {
  getAdminDatabaseUrl,
  getAppDatabaseUrl,
  getTemporalAddress,
} from './integration-config';
import { connectPostgres, requireEnv, runMigrations } from './helpers';

/**
 * Slice 5 Claim 14: prove the REAL production chain end-to-end through Temporal:
 *   Temporal -> MissionExecutionEngine -> AgentExecutor -> real specialist
 *   (SpecialistImplementationRegistry -> ResearchSpecialist)
 *   -> ProductionReasoningEngine -> LLMRouter -> real provider adapter
 *   -> local HTTP mock -> validated result -> invocation accounting.
 *
 * The worker's activities.ts module builds the real production graph
 * (ControlPlaneAgentRegistry, ControlPlanePolicyClient, SpecialistImplementationRegistry,
 * ProductionReasoningEngine, LLMRouter, real OpenAI/Anthropic providers). It reads
 * provider base URLs and secrets from the environment at import time, so this spec
 * points OPENAI_BASE_URL / ANTHROPIC_BASE_URL at the local mock and supplies dummy
 * provider secrets BEFORE importing activities.
 */

const TENANT = 'tenant-temporal-llm';

const VALID_REASONING = JSON.stringify({
  rationale: 'Temporal E2E rationale.',
  conclusion: 'Proceed with research task.',
  confidence: 0.9,
  evidence: ['evidence-1'],
  requiredApprovals: [],
  proposedActions: [],
  assumptions: [],
});

interface MockReply {
  status: number;
  content?: string;
  usage?: { input: number; output: number };
}

class MockLLMServer {
  private server!: Server;
  public baseUrl = '';
  public readonly requests: { provider: string; body: string }[] = [];
  public script: { openai: MockReply; anthropic: MockReply } = {
    openai: { status: 200, content: VALID_REASONING, usage: { input: 12, output: 34 } },
    anthropic: { status: 200, content: VALID_REASONING, usage: { input: 12, output: 34 } },
  };

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

  count(): number {
    return this.requests.length;
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = req.url ?? '';
      if (url.includes('/v1/chat/completions')) {
        this.requests.push({ provider: 'openai', body });
        this.reply(res, this.script.openai, 'openai');
      } else if (url.includes('/v1/messages')) {
        this.requests.push({ provider: 'anthropic', body });
        this.reply(res, this.script.anthropic, 'anthropic');
      } else {
        res.writeHead(404).end('not found');
      }
    });
  }

  private reply(res: ServerResponse, reply: MockReply, provider: 'openai' | 'anthropic'): void {
    if (reply.status !== 200) {
      res.writeHead(reply.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `${provider} mock error ${reply.status}` } }));
      return;
    }
    const usage = reply.usage ?? { input: 10, output: 20 };
    const payload =
      provider === 'openai'
        ? {
            id: `chatcmpl-${randomUUID()}`,
            choices: [
              { message: { role: 'assistant', content: reply.content ?? '' }, finish_reason: 'stop' },
            ],
            usage: {
              prompt_tokens: usage.input,
              completion_tokens: usage.output,
              total_tokens: usage.input + usage.output,
            },
          }
        : {
            id: `msg-${randomUUID()}`,
            content: [{ type: 'text', text: reply.content ?? '' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: usage.input, output_tokens: usage.output },
          };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  }
}

const INITIAL_PLAN = {
  planId: '',
  version: 0,
  objectives: [],
  phases: [],
  approvalGates: [],
  fallbackBranches: [],
};

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
  timeoutMs = 30_000,
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

describe('Slice 5 Temporal -> LLM E2E (real production chain)', () => {
  let appPool: Pool | undefined;
  let adminPool: Pool | undefined;
  let postgresClient: PostgresClient | undefined;
  let repo: PostgresMissionRepository | undefined;
  let invocationAccounting: PostgresInvocationAccounting | undefined;
  let nativeConnection: NativeConnection | undefined;
  let clientConnection: Connection | undefined;
  let client: WorkflowClient | undefined;
  let mock: MockLLMServer | undefined;
  const address = getTemporalAddress();
  const seeded = { capability: false, agent: false, models: false };

  function makeCommand(missionId: string, operatorId: string) {
    return {
      id: missionId,
      name: 'Slice 5 Temporal LLM Mission',
      objective: 'acme.example.com',
      icpId: 'icp-slice5',
      territory: ['US'],
      channels: ['email'],
      budget: { maxAiCostUsd: 1 },
      autonomyLevel: 5,
      constraints: {},
      successCriteria: { targetMeetings: 1 },
      ownerUserId: operatorId,
      plan: INITIAL_PLAN,
    };
  }

  async function seedControlPlane(admin: Pool): Promise<void> {
    // Capability used by the research task.
    const cap = await admin.query('SELECT 1 FROM control_plane.capabilities WHERE capability_id = $1', ['research']);
    if (cap.rowCount === 0) {
      await admin.query(
        `INSERT INTO control_plane.capabilities
           (capability_id, name, description, risk_category, allowed_tools, required_policies, version)
         VALUES ($1, $2, $3, $4, $5, $6, '1.0.0')`,
        ['research', 'Research', 'Research capability', 'LOW', [], []],
      );
      seeded.capability = true;
    }

    // Agent 'agent-1' resolved by ControlPlaneAgentRegistry -> specialist.research.v1.
    await admin.query(
      `INSERT INTO control_plane.agent_versions
         (version_id, agent_id, tenant_id, is_system, version, lifecycle, name, role, description,
          capabilities, tools, policies, model_policy, memory_policy, knowledge_policy,
          autonomy_level_default, evaluation_policy, owner, implementation_key, created_at, updated_at)
       VALUES ($1, $2, null, true, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), NOW())
       ON CONFLICT (version_id) DO UPDATE SET
         implementation_key = EXCLUDED.implementation_key,
         lifecycle = EXCLUDED.lifecycle,
         capabilities = EXCLUDED.capabilities,
         autonomy_level_default = EXCLUDED.autonomy_level_default,
         updated_at = NOW()`,
      [
        'slice5-temporal:agent-1:1.0.0',
        'agent-1',
        '1.0.0',
        'ACTIVE',
        'Slice 5 Research Agent',
        'researcher',
        'Research agent for Slice 5 Temporal LLM E2E',
        ['research'],
        [],
        JSON.stringify([]),
        JSON.stringify({}),
        JSON.stringify({}),
        JSON.stringify({}),
        5,
        JSON.stringify({}),
        'slice5-e2e',
        'specialist.research.v1',
      ],
    );
    seeded.agent = true;

    // Models eligible for the 'reasoning' capability, routed to the real providers.
    for (const m of [
      { id: 'gpt-4o-mini', provider: 'openai', family: 'gpt', priority: 1 },
      { id: 'claude-3-haiku-20240307', provider: 'anthropic', family: 'claude', priority: 2 },
    ]) {
      await admin.query(
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
    seeded.models = true;

    // Guard against a stale hard-deny policy blocking this run.
    await admin.query(
      `DELETE FROM control_plane.policies
       WHERE is_system = true AND scope = 'system' AND capability = 'research' AND outcome <> 'ALLOW'`,
    );
  }

  beforeAll(async () => {
    requireEnv();
    if (!(await isReachable(address))) {
      // eslint-disable-next-line no-console
      console.warn(`Skipping Slice 5 Temporal LLM E2E: Temporal ${address} unreachable`);
      return;
    }

    await runMigrations(getAdminDatabaseUrl());

    // Start the mock BEFORE importing activities so the env-driven provider
    // base URLs point at it.
    mock = new MockLLMServer();
    await mock.start();

    // Point the real provider adapters at the local mock and supply dummy
    // secrets. activities.ts reads these at module import time.
    process.env.DATABASE_URL = getAppDatabaseUrl();
    process.env.OPENAI_BASE_URL = mock.baseUrl;
    process.env.ANTHROPIC_BASE_URL = mock.baseUrl;
    process.env.OPENAI_API_KEY = 'e2e-openai-key';
    process.env.ANTHROPIC_API_KEY = 'e2e-anthropic-key';

    [appPool, adminPool] = await Promise.all([
      connectPostgres(getAppDatabaseUrl()),
      connectPostgres(getAdminDatabaseUrl()),
    ]);
    postgresClient = new PostgresClient(appPool);
    repo = new PostgresMissionRepository({ pool: appPool });
    invocationAccounting = new PostgresInvocationAccounting(postgresClient);

    await seedControlPlane(adminPool);

    // Seed the single deterministic ACTIVE embedding profile for the worker.
    const profileId = `profile-slice5-${randomUUID().slice(0, 8)}`;
    const profileVectorSpace = buildVectorSpace({
      providerId: 'deterministic',
      modelId: 'det-model',
      modelVersion: 'v1',
      dimensions: 64,
      distanceMetric: 'cosine',
    });
    await adminPool!.query('DELETE FROM embedding.embedding_profiles');
    await adminPool!.query(
      `INSERT INTO embedding.embedding_profiles
        (embedding_profile_id, provider_id, model_id, model_version, dimensions, distance_metric, vector_space, lifecycle, is_active)
       VALUES ($1,$2,$3,$4,$5,'cosine',$6,'ACTIVE',TRUE)`,
      [profileId, 'deterministic', 'det-model', 'v1', 64, profileVectorSpace],
    );

    nativeConnection = await NativeConnection.connect({ address });
    clientConnection = await Connection.connect({ address });
    client = new WorkflowClient({ connection: clientConnection });
  }, 60_000);

  afterAll(async () => {
    if (mock) await mock.stop();
    if (postgresClient) await postgresClient.end();
    if (adminPool) await adminPool.end();
    if (nativeConnection) await nativeConnection.close();
    if (clientConnection) await clientConnection.close();
  });

  it('drives a mission through Temporal to a real LLM call via the production chain', async () => {
    if (!nativeConnection || !client || !repo || !mock || !adminPool || !postgresClient || !invocationAccounting) return;

    const runId = Date.now();
    const tenantId = asTenantId(TENANT);
    const missionId = asMissionId(randomUUID());
    const correlationId = asCorrelationId(`corr-slice5-temporal-${runId}`);
    const operatorId = asUserId(randomUUID());
    const workspaceId = randomUUID();
    await adminPool.query('INSERT INTO identity.users(id,email,tenant_id) VALUES($1,$2,$3)', [operatorId, `${operatorId}@example.test`, tenantId]);
    await adminPool.query('INSERT INTO identity.workspaces(id,tenant_id,name,owner_user_id) VALUES($1,$2,$3,$4)', [workspaceId, tenantId, 'Slice 5', operatorId]);
    await adminPool.query("INSERT INTO identity.memberships(workspace_id,tenant_id,user_id,role) VALUES($1,$2,$3,'OPERATOR')", [workspaceId, tenantId, operatorId]);
    const ctx: CommandContext = {
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
      asCorrelationId(`corr-slice5-approve-${runId}`),
      asEventId(`evt-slice5-approve-${runId}`),
    );
    if (!approveResult.success) throw new Error(approveResult.error.message);
    await repo.save(ctx, mission);

    const taskQueue = `mission-slice5-llm-${runId}`;
    // Import activities AFTER env is set so the real providers target the mock.
    const activities = await import('../../../apps/temporal-worker/src/activities');
    await validateEmbeddingRuntime('deterministic');

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

      // The real provider adapter was invoked against the local mock.
      expect(mock.count()).toBeGreaterThan(0);

      // Invocation accounting recorded the real provider attempt(s) for the mission.
      const tenantCtx: TenantContext = { tenantId, correlationId };
      const invocations = await postgresClient.withTenant(tenantCtx, async (c) =>
        c.query('SELECT * FROM ai_runtime.llm_invocations WHERE mission_id = $1', [missionId as string]),
      );
      expect(invocations.rowCount ?? 0).toBeGreaterThan(0);
    } finally {
      worker.shutdown();
      await workerRun;
    }
  }, 120_000);
});
