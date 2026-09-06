import { createConnection } from 'net';
import { randomUUID } from 'crypto';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { Pool } from 'pg';
import { Connection, WorkflowClient } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import {
  PostgresClient,
  PostgresAuditLog,
  EnvironmentSecretsProvider,
  NoOpTelemetry,
} from '@projectx/infrastructure';
import {
  AgentExecutor,
  ContextAssembler,
  InMemoryCheckpointStore,
  InMemoryKnowledgeRetriever,
  InMemoryMemoryRetriever,
  PolicyAwareDecisionEngine,
  StructuredOutputValidator,
  ToolExecutor,
  type IAgentImplementation,
  type IAgentImplementationRegistry,
  type AgentImplementationRuntime,
  type IReasoningEngine,
  type ReasoningOutput,
} from '@projectx/ai-runtime';
import {
  ControlPlaneAgentRegistry,
  ControlPlanePolicyClient,
  PolicyEvaluationService,
  PostgresAgentRepository,
  PostgresAuditSink,
  PostgresAutonomyRepository,
  PostgresCapabilityRepository,
  PostgresEmergencyStopProvider,
  PostgresPolicyRepository,
  type PostgresControlPlaneRepositoryConfig,
} from '@projectx/control-plane';
import { PostgresExecutionApprovalBinding } from '@projectx/mission-orchestrator';
import {
  asCorrelationId,
  asIdempotencyKey,
  asTenantId,
  type AIExecutionRequest,
  type AIExecutionResult,
  type ToolCallRequest,
  type ToolCallResult,
} from '@projectx/shared';
import type { TenantContext } from '@projectx/domain';
import { buildGovernedToolGateway } from '../../../apps/temporal-worker/src/tool-gateway-wiring';
import { getAdminDatabaseUrl, getAppDatabaseUrl, getTemporalAddress } from './integration-config';
import { connectPostgres, requireEnv, runMigrations } from './helpers';
import type { GovernedToolCallArgs, GovernedToolCallResult } from './slice6-tool-workflow';

/**
 * Slice 6 claim [17] — Temporal-anchored governed tool execution.
 *
 * Proves the literal production chain end-to-end through a running Temporal
 * worker:
 *   Temporal worker -> workflow -> activity -> AgentExecutor -> ToolExecutor
 *   -> ToolGateway -> real HttpToolProvider -> local deterministic HTTP server
 *   -> validated ToolResult -> persisted tool_invocation + attempt.
 *
 * Real production implementations are used for every governed component:
 * AgentExecutor, ToolExecutor, ToolGateway, provider routing, HttpToolProvider,
 * Postgres-backed registry/invocation/idempotency repositories, and the
 * Control Plane policy/authorization path. The ONLY mocked boundary is the
 * external HTTP service itself (a local deterministic server). The specialist
 * that emits the tool call is the minimal test fixture required to drive the
 * existing production AgentExecutor -> toolClient path; it is not a substitute
 * for any governed component.
 */

const TENANT = 'tenant-slice6-temporal';
const TOOL_ID = 'local_http_echo';
const TOOL_VERSION = '1.0.0';
const CAPABILITY = 'http.invoke';
const IMPL_KEY = 'specialist.toolcall.v1';
const AGENT_ID = 'agent-slice6-tool';
const AGENT_VERSION = '1.0.0';
const ROUTE = 'local';

/** Deterministic local HTTP service — the only mocked external boundary. */
class LocalToolServer {
  private server!: Server;
  public baseUrl = '';
  public readonly requests: { url: string; body: string; correlationId?: string }[] = [];

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
      this.requests.push({
        url: req.url ?? '',
        body,
        correlationId: req.headers['x-correlation-id'] as string | undefined,
      });
      res.writeHead(200, { 'content-type': 'application/json', 'x-request-id': `preq-${randomUUID()}` });
      res.end(JSON.stringify({ result: 'ok', echoed: true }));
    });
  }
}

/**
 * Minimal test specialist: the fixture that causes the production AgentExecutor
 * to invoke the governed tool path. It calls runtime.toolClient.call() — the
 * real ToolExecutor -> ToolGateway -> provider chain — and captures the result.
 */
class ToolCallingSpecialist implements IAgentImplementation {
  readonly implementationKey = IMPL_KEY;
  constructor(
    private readonly toolCall: ToolCallRequest,
    private readonly capture: { toolResult?: ToolCallResult },
  ) {}

  async execute(request: AIExecutionRequest, runtime: AgentImplementationRuntime): Promise<AIExecutionResult> {
    const result = await runtime.toolClient.call(this.toolCall);
    this.capture.toolResult = result;
    return {
      executionId: request.executionId,
      tenantId: request.tenantId,
      missionId: request.missionId,
      status: result.status === 'SUCCESS' ? 'COMPLETED' : 'FAILED',
      outcome: {
        summary: `tool:${result.status}`,
        decisions: [],
        actions: [{ type: 'request_tool', toolId: this.toolCall.toolId, status: result.status }],
        evidence: [{ toolStatus: result.status }],
      },
      modelUsage: { model: 'slice6-tool', inputTokens: 0, outputTokens: 0, costUsd: 0 },
      startedAt: runtime.startedAt,
      completedAt: new Date(),
      correlationId: request.correlationId,
      events: ['ExecutionCompleted'],
    };
  }
}

/** Map-backed implementation registry exposing only the test specialist. */
class MapImplRegistry implements IAgentImplementationRegistry {
  constructor(private readonly impls: readonly IAgentImplementation[]) {}
  resolve(implementationKey: string): IAgentImplementation | null {
    return this.impls.find((i) => i.implementationKey === implementationKey) ?? null;
  }
}

/** Deterministic reasoning stub — drives the decision engine to proceed. */
class StubReasoningEngine implements IReasoningEngine {
  async reason(): Promise<ReasoningOutput> {
    return {
      rationale: 'slice6 temporal tool test',
      conclusion: 'proceed',
      confidence: 0.95,
      evidence: [],
      proposedActions: [],
      requiredApprovals: [],
      assumptions: [],
      modelUsage: { model: 'stub', inputTokens: 1, outputTokens: 1, costUsd: 0 },
    };
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

describe('Slice 6 claim [17] — Temporal-anchored governed tool execution', () => {
  let appPool: Pool | undefined;
  let adminPool: Pool | undefined;
  let postgresClient: PostgresClient | undefined;
  let nativeConnection: NativeConnection | undefined;
  let clientConnection: Connection | undefined;
  let client: WorkflowClient | undefined;
  let server: LocalToolServer | undefined;
  let toolExecutor: ToolExecutor | undefined;
  let agentRegistry: ControlPlaneAgentRegistry | undefined;
  let policyClient: ControlPlanePolicyClient | undefined;
  let approvalBinding: PostgresExecutionApprovalBinding | undefined;
  let toolDefinitionId = '';
  const address = getTemporalAddress();
  // In-process capture for the ToolCallResult produced inside the activity.
  const capture: { toolResult?: ToolCallResult } = {};

  async function seed(admin: Pool): Promise<void> {
    // Capability the tool requires and the agent is granted.
    await admin.query(
      `INSERT INTO control_plane.capabilities
         (capability_id, name, description, risk_category, allowed_tools, required_policies, version)
       VALUES ($1, $2, $3, $4, $5, $6, '1.0.0')
       ON CONFLICT (capability_id) DO NOTHING`,
      [CAPABILITY, 'HTTP Invoke', 'Governed HTTP tool invocation', 'LOW', [TOOL_ID], []],
    );

    // Agent resolved by ControlPlaneAgentRegistry -> test specialist.
    await admin.query(
      `INSERT INTO control_plane.agent_versions
         (version_id, agent_id, tenant_id, is_system, version, lifecycle, name, role, description,
          capabilities, tools, policies, model_policy, memory_policy, knowledge_policy,
          autonomy_level_default, evaluation_policy, owner, implementation_key, created_at, updated_at)
       VALUES ($1, $2, null, true, $3, 'ACTIVE', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW())
       ON CONFLICT (version_id) DO UPDATE SET
         implementation_key = EXCLUDED.implementation_key,
         lifecycle = EXCLUDED.lifecycle,
         capabilities = EXCLUDED.capabilities,
         autonomy_level_default = EXCLUDED.autonomy_level_default,
         updated_at = NOW()`,
      [
        `slice6-temporal:${AGENT_ID}:${AGENT_VERSION}`,
        AGENT_ID,
        AGENT_VERSION,
        'Slice 6 Tool Agent',
        'tool-runner',
        'Agent that drives the governed tool path for claim [17]',
        [CAPABILITY],
        [TOOL_ID],
        JSON.stringify([]),
        JSON.stringify({}),
        JSON.stringify({}),
        JSON.stringify({}),
        5,
        JSON.stringify({}),
        'slice6-e2e',
        IMPL_KEY,
      ],
    );

    // Guard against a stale hard-deny policy blocking this run.
    await admin.query(
      `DELETE FROM control_plane.policies
       WHERE is_system = true AND scope = 'system' AND capability = $1 AND outcome <> 'ALLOW'`,
      [CAPABILITY],
    );

    // Pinned tool definition routed to the real 'http' provider.
    toolDefinitionId = `td-${TOOL_ID}-${TOOL_VERSION}-${TENANT}`;
    await admin.query(
      `INSERT INTO tool_registry.tool_definitions
         (tool_definition_id, tool_id, version, tenant_id, description, required_capabilities,
          risk_category, side_effect_class, required_approval, provider_id, enabled,
          timeout_seconds, max_retries, idempotency_required, lifecycle, input_schema, output_schema)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (tool_definition_id) DO UPDATE SET
         lifecycle = EXCLUDED.lifecycle, enabled = EXCLUDED.enabled`,
      [
        toolDefinitionId,
        TOOL_ID,
        TOOL_VERSION,
        TENANT,
        'Slice 6 deterministic local HTTP echo tool',
        [CAPABILITY],
        'LOW',
        'READ_ONLY',
        false,
        'http',
        true,
        10,
        0,
        true,
        'ACTIVE',
        JSON.stringify({ type: 'object', required: ['q'], properties: { q: { type: 'string' } } }),
        JSON.stringify({
          type: 'object',
          required: ['result'],
          properties: { result: { type: 'string' }, echoed: { type: 'boolean' } },
        }),
      ],
    );
  }

  beforeAll(async () => {
    requireEnv();
    // Claim [17] must never silently skip: an unreachable integration service
    // is a hard setup failure, not a green pass.
    if (!(await isReachable(address))) {
      throw new Error(
        `Slice 6 Claim [17] requires Temporal at ${address}; integration service is unreachable`,
      );
    }

    await runMigrations(getAdminDatabaseUrl());

    server = new LocalToolServer();
    await server.start();

    process.env.DATABASE_URL = getAppDatabaseUrl();

    [appPool, adminPool] = await Promise.all([
      connectPostgres(getAppDatabaseUrl()),
      connectPostgres(getAdminDatabaseUrl()),
    ]);
    postgresClient = new PostgresClient(appPool);

    await seed(adminPool);

    // Real production Control Plane policy/authorization path.
    const auditLog = new PostgresAuditLog({ pool: appPool });
    const auditSink = new PostgresAuditSink(auditLog);
    const repoConfig: PostgresControlPlaneRepositoryConfig = { client: postgresClient };
    const agentRepository = new PostgresAgentRepository(repoConfig);
    const capabilityRepository = new PostgresCapabilityRepository(repoConfig);
    const policyRepository = new PostgresPolicyRepository(repoConfig);
    const autonomyRepository = new PostgresAutonomyRepository(repoConfig);
    const emergencyStopProvider = new PostgresEmergencyStopProvider(repoConfig);
    const secretsProvider = new EnvironmentSecretsProvider();

    const policyEvaluationService = new PolicyEvaluationService({
      emergencyStopProvider,
      policyRepository,
      autonomyRepository,
      auditSink,
    });
    agentRegistry = new ControlPlaneAgentRegistry({ agentRepository, capabilityRepository });
    policyClient = new ControlPlanePolicyClient({ policyEvaluationService });
    approvalBinding = new PostgresExecutionApprovalBinding(postgresClient);

    // Real governed ToolGateway via the production wiring factory. The HTTP
    // provider egress policy is privileged server config; here it pins a named
    // route to the local deterministic server (the only mocked boundary).
    const governedToolGateway = buildGovernedToolGateway({
      pool: appPool,
      policyClient,
      approvalBinding,
      secrets: secretsProvider,
      httpEgress: {
        allowedHosts: ['127.0.0.1', 'localhost'],
        allowedSchemes: ['http'],
        allowPrivateNetwork: true,
        allowRedirects: false,
        routes: { [ROUTE]: { baseUrl: server.baseUrl } },
      },
      policyDefaults: { autonomyLevel: 5, tenantPolicyVersion: '1.0.0', missionPolicyVersion: '1.0.0' },
    });
    toolExecutor = new ToolExecutor(governedToolGateway, new NoOpTelemetry());

    nativeConnection = await NativeConnection.connect({ address });
    clientConnection = await Connection.connect({ address });
    client = new WorkflowClient({ connection: clientConnection });
  }, 60_000);

  afterAll(async () => {
    if (server) await server.stop();
    if (postgresClient) await postgresClient.end();
    if (adminPool) await adminPool.end();
    if (nativeConnection) await nativeConnection.close();
    if (clientConnection) await clientConnection.close();
  });

  it('drives a governed tool call through Temporal to the real HttpToolProvider', async () => {
    if (!nativeConnection || !client || !server || !adminPool || !postgresClient || !toolExecutor || !agentRegistry || !policyClient || !approvalBinding || !appPool) {
      throw new Error('Slice 6 Claim [17] setup incomplete: required services not initialized');
    }

    const runId = randomUUID();
    const executionId = `exec-${runId}`;
    const missionId = `mission-${runId}`;
    const taskId = `task-${runId}`;
    const correlationId = `corr-slice6-temporal-${runId}`;
    const idempotencyKey = `idem-${runId}`;
    const tenantId = asTenantId(TENANT);
    const tenantCtx: TenantContext = { tenantId, correlationId: asCorrelationId(correlationId) };

    // The activity closes over the real production chain. It builds the
    // specialist fixture + AgentExecutor per invocation and runs the governed
    // tool call. Non-deterministic provider/DB work stays inside the activity.
    const activities = {
      runGovernedToolCall: async (args: GovernedToolCallArgs): Promise<GovernedToolCallResult> => {
        const aTenant = asTenantId(args.tenantId);
        const aCorr = asCorrelationId(args.correlationId);
        const toolCall: ToolCallRequest = {
          toolCallId: `tc-${args.executionId}`,
          toolId: args.toolId,
          toolVersion: args.toolVersion,
          tenantId: aTenant,
          missionId: args.missionId,
          agentId: args.agentId,
          agentVersion: args.agentVersion,
          executionId: args.executionId,
          taskId: args.taskId,
          correlationId: aCorr,
          idempotencyKey: asIdempotencyKey(args.idempotencyKey),
          authorization: {
            policyDecisionId: 'pd-slice6-temporal',
            decision: 'ALLOW',
            capabilities: [CAPABILITY],
            expiresAt: new Date(Date.now() + 60_000),
          },
          riskCategory: 'LOW',
          input: args.input,
          timeoutSeconds: 10,
          metadata: { route: args.route, autonomyLevel: args.autonomyLevel },
        };
        const specialist = new ToolCallingSpecialist(toolCall, capture);
        const executor = new AgentExecutor({
          agentRegistry: agentRegistry!,
          policyClient: policyClient!,
          contextAssembler: new ContextAssembler({
            memoryRetriever: new InMemoryMemoryRetriever(),
            knowledgeRetriever: new InMemoryKnowledgeRetriever(),
          }),
          memoryRetriever: new InMemoryMemoryRetriever(),
          knowledgeRetriever: new InMemoryKnowledgeRetriever(),
          reasoningEngine: new StubReasoningEngine(),
          decisionEngine: new PolicyAwareDecisionEngine(),
          toolClient: toolExecutor!,
          outputValidator: new StructuredOutputValidator({
            requiredFields: [],
            forbiddenValues: [],
            allowedActions: [],
            piiPatterns: [],
          }),
          telemetry: new NoOpTelemetry(),
          checkpointStore: new InMemoryCheckpointStore(),
          implementationRegistry: new MapImplRegistry([specialist]),
          approvalBinding: approvalBinding!,
        });
        const aiRequest: AIExecutionRequest = {
          executionId: args.executionId,
          tenantId: aTenant,
          missionId: args.missionId,
          agentId: args.agentId,
          agentVersion: args.agentVersion,
          taskId: args.taskId,
          taskType: 'tool.invoke',
          correlationId: aCorr,
          context: {},
          capabilities: [CAPABILITY],
          policyContext: {
            autonomyLevel: args.autonomyLevel,
            riskCategory: 'LOW',
            tenantPolicyVersion: '1.0.0',
            missionPolicyVersion: '1.0.0',
          },
          budget: { maxTokens: 100_000, maxCostUsd: 1, maxDurationSeconds: 60 },
          idempotencyKey: asIdempotencyKey(args.idempotencyKey),
        };
        const result = await executor.execute(aiRequest);
        return {
          status: result.status,
          executionId: result.executionId,
          outcome: { summary: result.outcome?.summary },
        };
      },
    };

    const taskQueue = `slice6-tool-${runId}`;
    const worker = await Worker.create({
      connection: nativeConnection,
      taskQueue,
      workflowsPath: require.resolve('./slice6-tool-workflow'),
      activities,
    });
    const workerRun = worker.run().catch(() => {});

    try {
      const handle = await client.start('slice6ToolWorkflow', {
        taskQueue,
        workflowId: `slice6-tool-wf-${runId}`,
        args: [
          {
            tenantId: TENANT,
            correlationId,
            executionId,
            missionId,
            agentId: AGENT_ID,
            agentVersion: AGENT_VERSION,
            taskId,
            idempotencyKey,
            toolId: TOOL_ID,
            toolVersion: TOOL_VERSION,
            route: ROUTE,
            input: { q: 'hello' },
            autonomyLevel: 5,
          } satisfies GovernedToolCallArgs,
        ],
      });

      const wfResult = await handle.result();

      // Workflow completed successfully.
      expect(wfResult.status).toBe('COMPLETED');
      expect(wfResult.executionId).toBe(executionId);

      // Exactly one provider request reached the local HTTP server.
      expect(server.count()).toBe(1);
      expect(server.requests[0]!.url).toContain('/');

      // The governed tool result was produced and schema-validated.
      const toolResult = capture.toolResult;
      expect(toolResult).toBeDefined();
      expect(toolResult!.status).toBe('SUCCESS');
      expect(toolResult!.validation.schemaValid).toBe(true);
      expect(toolResult!.provider).toBe('http');

      // Logical tool_invocation persisted (tenant + pinned definition/version).
      const invRows = await postgresClient.withTenant(tenantCtx, async (c) =>
        c.query(
          `SELECT tool_call_id, tool_definition_id, tool_id, version, tenant_id, status
             FROM tool_registry.tool_invocations WHERE tool_call_id = $1`,
          [toolResult!.toolCallId],
        ),
      );
      expect(invRows.rowCount).toBe(1);
      const inv = invRows.rows[0]!;
      expect(inv.tenant_id).toBe(TENANT);
      expect(inv.tool_id).toBe(TOOL_ID);
      expect(inv.version).toBe(TOOL_VERSION);
      expect(inv.tool_definition_id).toBe(toolDefinitionId);
      expect(inv.status).toBe('SUCCESS');

      // Physical attempt persisted; terminal submitted/resultKnown known.
      const attRows = await postgresClient.withTenant(tenantCtx, async (c) =>
        c.query(
          `SELECT attempt, attempt_status, submitted, result_known
             FROM tool_registry.tool_invocation_attempts
            WHERE tool_call_id = $1 ORDER BY attempt`,
          [toolResult!.toolCallId],
        ),
      );
      expect(attRows.rowCount).toBe(1);
      const att = attRows.rows[0]!;
      expect(att.attempt).toBe(1);
      expect(att.submitted).toBe(true);
      expect(att.result_known).toBe(true);
      expect(['COMPLETED', 'SUCCESS']).toContain(att.attempt_status);
    } finally {
      worker.shutdown();
      await workerRun;
    }
  }, 120_000);
});
