import { randomUUID } from 'crypto';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { Pool } from 'pg';
import type { TenantContext } from '@projectx/domain';
import { PostgresClient, NoOpTelemetry } from '@projectx/infrastructure';
import type { ISecretsProvider } from '@projectx/infrastructure';
import {
  AgentExecutor,
  ContextAssembler,
  InMemoryCheckpointStore,
  InMemoryKnowledgeRetriever,
  InMemoryMemoryRetriever,
  PolicyAwareDecisionEngine,
  ProductionReasoningEngine,
  PostgresInvocationAccounting,
  PostgresReasoningArtifactRepository,
  StructuredOutputValidator,
  ToolExecutor,
} from '@projectx/ai-runtime';
import type {
  IPolicyClient,
  PolicyDecision,
  IAgentRegistry,
  ResolvedAgent,
} from '@projectx/ai-runtime';
import {
  ProviderRegistry,
  LLMRouter,
  OpenAIProvider,
  AnthropicProvider,
  InMemoryExecutionBudgetLedger,
} from '@projectx/llm-gateway';
import type { IModelCatalog, LLMModel } from '@projectx/llm-gateway';
import { PostgresExecutionApprovalBinding } from '@projectx/mission-orchestrator';
import { SpecialistImplementationRegistry } from '@projectx/specialist-agents';
import { asCorrelationId, asIdempotencyKey, asTenantId } from '@projectx/shared';
import type {
  IAgentImplementation,
  IAgentImplementationRegistry,
  AgentImplementationRuntime,
} from '@projectx/ai-runtime';
import type {
  AIExecutionRequest,
  AIExecutionResult,
  AgentContract,
  CorrelationId,
  TenantId,
  ToolCallRequest,
  ToolCallResult,
} from '@projectx/shared';
import { connectPostgres, runMigrations, DEFAULT_APP_DATABASE_URL } from './helpers';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

/** Valid structured reasoning payload satisfying the output validator. */
const VALID_REASONING = JSON.stringify({
  rationale: 'Deterministic E2E rationale.',
  conclusion: 'Proceed with research task.',
  confidence: 0.9,
  evidence: ['evidence-1'],
  requiredApprovals: [],
  proposedActions: [],
  assumptions: [],
});

/** Valid JSON but missing required reasoning fields -> schema violation. */
const INVALID_SCHEMA_REASONING = JSON.stringify({ foo: 'bar' });

// ---------------------------------------------------------------------------
// Programmable local HTTP mock standing in for the real provider endpoints.
// The REAL OpenAIProvider / AnthropicProvider adapters dispatch actual HTTP
// requests to this server, so the full request/response/usage-parsing path is
// exercised. The mock records every request so tests can assert the exact
// number of provider calls (including the "zero calls" governance claims).
// ---------------------------------------------------------------------------
interface MockReply {
  status: number;
  /** For a 200 reply, the assistant text content (a JSON string for structured output). */
  content?: string;
  usage?: { input: number; output: number };
}

class MockLLMServer {
  private server!: Server;
  public baseUrl = '';
  public readonly requests: { provider: 'openai' | 'anthropic'; body: string }[] = [];
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

  reset(): void {
    this.requests.length = 0;
    this.script = {
      openai: { status: 200, content: VALID_REASONING, usage: { input: 12, output: 34 } },
      anthropic: { status: 200, content: VALID_REASONING, usage: { input: 12, output: 34 } },
    };
  }

  count(provider?: 'openai' | 'anthropic'): number {
    return provider ? this.requests.filter((r) => r.provider === provider).length : this.requests.length;
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

// ---------------------------------------------------------------------------
// Deterministic test doubles for non-Slice-5 concerns (agent resolution, model
// catalog, policy outcome). The Slice 5 surface under test — providers, router,
// budget ledger, invocation accounting, artifact persistence, approval binding
// — uses the REAL implementations.
// ---------------------------------------------------------------------------
const stubSecrets: ISecretsProvider = {
  async getSecret(): Promise<string> {
    return 'e2e-test-key-not-a-real-secret';
  },
  async getCertificate(): Promise<Buffer> {
    return Buffer.from('e2e');
  },
};

class StaticModelCatalog implements IModelCatalog {
  constructor(private readonly models: readonly LLMModel[]) {}
  async listEligibleModels(): Promise<readonly LLMModel[]> {
    return this.models;
  }
}

const OPENAI_MODEL: LLMModel = {
  modelId: 'gpt-4o-mini',
  providerId: 'openai',
  family: 'gpt',
  capabilities: ['reasoning', 'chat'],
  maxContextTokens: 128_000,
  costPerInputTokenUsd: 5e-7,
  costPerOutputTokenUsd: 1.5e-6,
  supportsStructuredOutput: true,
  latencyClass: 'background',
  lifecycle: 'ACTIVE',
  priority: 1,
};

const ANTHROPIC_MODEL: LLMModel = {
  modelId: 'claude-3-haiku-20240307',
  providerId: 'anthropic',
  family: 'claude',
  capabilities: ['reasoning', 'chat'],
  maxContextTokens: 200_000,
  costPerInputTokenUsd: 8e-7,
  costPerOutputTokenUsd: 2.5e-6,
  supportsStructuredOutput: true,
  latencyClass: 'background',
  lifecycle: 'ACTIVE',
  priority: 2,
};

function buildAgentContract(): AgentContract {
  return {
    agentId: 'research-agent',
    name: 'Research Agent',
    role: 'research',
    description: 'E2E research agent',
    capabilities: ['research'],
    tools: [],
    policies: [],
    modelPolicy: { preferredModelFamily: 'gpt', maxCostPerTaskUsd: 1, maxTokensPerTask: 4000 },
    memoryPolicy: { read: [], write: [], validationRequired: false },
    knowledgePolicy: { read: [], write: [] },
    autonomyLevelDefault: 3,
    evaluationPolicy: { criteria: [], minScore: 0 },
    lifecycle: 'ACTIVE',
    owner: 'e2e',
    version: '1.0.0',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

class StaticAgentRegistry implements IAgentRegistry {
  private readonly agent: ResolvedAgent;
  constructor(implementationKey = 'research-impl') {
    const contract = buildAgentContract();
    this.agent = {
      ...contract,
      versionId: `${contract.agentId}:${contract.version}`,
      tenantId: null,
      isSystem: true,
      implementationKey,
      contract,
    };
  }
  async getAgent(): Promise<ResolvedAgent | null> {
    return this.agent;
  }
  async getCapability(): Promise<{ capabilityId: string; allowedTools: string[] } | null> {
    return { capabilityId: 'research', allowedTools: [] };
  }
}

class ControllablePolicyClient implements IPolicyClient {
  public outcome: 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY' = 'ALLOW';
  async evaluate(_ctx: TenantContext, request: AIExecutionRequest): Promise<PolicyDecision> {
    return {
      decisionId: `pol-${randomUUID()}`,
      tenantId: request.tenantId as unknown as string,
      outcome: this.outcome,
      capabilities: request.capabilities,
      action: 'agent_execution',
      evaluatedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    };
  }
}

class NoopToolClient {
  async call(request: ToolCallRequest): Promise<ToolCallResult> {
    throw new Error(`No-op tool client cannot execute ${request.toolId}`);
  }
}

/**
 * Deterministic implementation registry. Slice 5 acceptance targets the LLM
 * runtime path (reasoning + provider calls + accounting), not the specialist
 * work itself, so the resolved implementation returns a COMPLETED result
 * carrying the reasoning model usage. This keeps the executor's post-decision
 * path exercised without pulling in real specialist agents.
 */
class StubImplementationRegistry implements IAgentImplementationRegistry {
  resolve(implementationKey: string): IAgentImplementation | null {
    if (implementationKey !== 'research-impl') return null;
    return {
      implementationKey,
      async execute(request: AIExecutionRequest, runtime: AgentImplementationRuntime): Promise<AIExecutionResult> {
        const usage = runtime.reasoningOutput?.modelUsage;
        return {
          executionId: request.executionId,
          tenantId: request.tenantId,
          missionId: request.missionId,
          status: 'COMPLETED',
          outcome: {
            summary: runtime.reasoningOutput?.conclusion ?? 'completed',
            decisions: [],
            actions: [],
            evidence: runtime.reasoningOutput?.evidence ?? [],
          },
          modelUsage: usage ?? { model: 'none', inputTokens: 0, outputTokens: 0, costUsd: 0, provider: 'none', latencyMs: 0 },
          startedAt: runtime.startedAt,
          completedAt: new Date(),
          correlationId: request.correlationId,
          events: [],
        };
      },
    };
  }
}

function buildRequest(overrides: Partial<AIExecutionRequest> = {}): AIExecutionRequest {
  return {
    executionId: `exec-slice5-${randomUUID()}`,
    tenantId: asTenantId(TENANT_A),
    missionId: 'mission-slice5',
    agentId: 'research-agent',
    agentVersion: '1.0.0',
    taskId: 'task-research',
    taskType: 'research',
    correlationId: asCorrelationId(randomUUID()),
    context: { target: { companyName: 'Acme Corp', domain: 'acme.example.com', researchScope: 'company' } },
    capabilities: ['research'],
    policyContext: {
      autonomyLevel: 3,
      riskCategory: 'LOW',
      tenantPolicyVersion: 'v1',
      missionPolicyVersion: 'v1',
    },
    budget: { maxTokens: 4000, maxCostUsd: 1, maxDurationSeconds: 60 },
    idempotencyKey: asIdempotencyKey(`idem-slice5-${randomUUID()}`),
    metadata: {},
    ...overrides,
  };
}

describe('Slice 5 LLM Runtime E2E (real adapters + local HTTP mock)', () => {
  let pool: Pool;
  let postgresClient: PostgresClient;
  let mock: MockLLMServer;
  let policyClient: ControllablePolicyClient;
  let budgetLedger: InMemoryExecutionBudgetLedger;
  let invocationAccounting: PostgresInvocationAccounting;
  let approvalBinding: PostgresExecutionApprovalBinding;
  let agentExecutor: AgentExecutor;
  let reasoningEngine: ProductionReasoningEngine;
  let memory: InMemoryMemoryRetriever;
  let knowledge: InMemoryKnowledgeRetriever;

  const makeExecutor = (agentRegistry: IAgentRegistry, implementationRegistry: IAgentImplementationRegistry): AgentExecutor =>
    new AgentExecutor({
      agentRegistry,
      implementationRegistry,
      policyClient,
      contextAssembler: new ContextAssembler({ memoryRetriever: memory, knowledgeRetriever: knowledge }),
      memoryRetriever: memory,
      knowledgeRetriever: knowledge,
      reasoningEngine,
      decisionEngine: new PolicyAwareDecisionEngine(),
      toolClient: new ToolExecutor(new NoopToolClient() as any, new NoOpTelemetry(), { maxRetries: 0, baseDelayMs: 10 }),
      outputValidator: new StructuredOutputValidator({
        requiredFields: [],
        forbiddenValues: [],
        allowedActions: [],
        piiPatterns: [],
      }),
      telemetry: new NoOpTelemetry(),
      checkpointStore: new InMemoryCheckpointStore(),
      approvalBinding,
    });

  beforeAll(async () => {
    await runMigrations();
    // Connect as the RLS-subject app role (projectx_app), not the superuser.
    // runMigrations sets DATABASE_URL to the admin URL; getAppDatabaseUrl would
    // otherwise pick that up and bypass row-level security entirely.
    pool = await connectPostgres(DEFAULT_APP_DATABASE_URL);
    postgresClient = new PostgresClient(pool);

    mock = new MockLLMServer();
    await mock.start();

    invocationAccounting = new PostgresInvocationAccounting(postgresClient);
    const reasoningArtifactRepository = new PostgresReasoningArtifactRepository(postgresClient);
    approvalBinding = new PostgresExecutionApprovalBinding(postgresClient);
    budgetLedger = new InMemoryExecutionBudgetLedger();
    policyClient = new ControllablePolicyClient();

    // REAL provider adapters pointed at the local mock.
    const providerRegistry = new ProviderRegistry();
    providerRegistry.register(
      new OpenAIProvider({
        providerId: 'openai',
        baseUrl: mock.baseUrl,
        secretName: 'openai-api-key',
        secretProvider: stubSecrets,
        defaultModelId: 'gpt-4o-mini',
        timeoutMs: 5000,
      }),
    );
    providerRegistry.register(
      new AnthropicProvider({
        providerId: 'anthropic',
        baseUrl: mock.baseUrl,
        secretName: 'anthropic-api-key',
        secretProvider: stubSecrets,
        defaultModelId: 'claude-3-haiku-20240307',
        timeoutMs: 5000,
      }),
    );

    const modelCatalog = new StaticModelCatalog([OPENAI_MODEL, ANTHROPIC_MODEL]);

    const llmRouter = new LLMRouter(
      modelCatalog,
      providerRegistry,
      async (event) => {
        await invocationAccounting.record(
          {
            tenantId: event.tenantId as unknown as TenantId,
            correlationId: event.correlationId as CorrelationId,
          },
          {
            tenantId: event.tenantId as unknown as TenantId,
            missionId: event.missionId,
            executionId: event.executionId,
            llmCallId: event.llmCallId,
            attempt: event.attempt,
            providerId: event.providerId,
            modelId: event.modelId,
            providerRequestId: event.providerRequestId,
            capability: event.capability,
            status: event.status,
            submitted: event.submitted,
            usageKnown: event.usageKnown,
            failureClassification: event.failureClassification,
            retryable: event.retryable,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            totalTokens: event.totalTokens,
            costUsd: event.costUsd,
            estimatedCostUsd: event.estimatedCostUsd,
            latencyMs: event.latencyMs,
            startedAt: event.startedAt,
            completedAt: event.completedAt,
            correlationId: event.correlationId,
            idempotencyKey: event.idempotencyKey,
            recordedAt: new Date(),
          },
        );
      },
      { defaultCapability: 'reasoning' },
      budgetLedger,
    );

    reasoningEngine = new ProductionReasoningEngine({
      llmRouter,
      artifactRepository: reasoningArtifactRepository,
    });

    memory = new InMemoryMemoryRetriever();
    knowledge = new InMemoryKnowledgeRetriever();

    agentExecutor = makeExecutor(new StaticAgentRegistry(), new StubImplementationRegistry());
  });

  afterAll(async () => {
    if (mock) await mock.stop();
    if (postgresClient) await postgresClient.end();
  });

  beforeEach(() => {
    mock.reset();
    policyClient.outcome = 'ALLOW';
  });

  const ctxFor = (tenantId: string, correlationId: string): TenantContext =>
    ({ tenantId: asTenantId(tenantId), correlationId: correlationId as CorrelationId }) as TenantContext;

  it('cross-provider fallback: openai HTTP 500 -> anthropic success, two attempt rows share one llm_call_id', async () => {
    mock.script.openai = { status: 500 };
    mock.script.anthropic = { status: 200, content: VALID_REASONING, usage: { input: 12, output: 34 } };

    const request = buildRequest();
    const result = await agentExecutor.execute(request);

    expect(result.status).toBe('COMPLETED');
    expect(result.modelUsage.provider).toBe('anthropic');
    // Real HTTP: openai attempted once, anthropic attempted once.
    expect(mock.count('openai')).toBe(1);
    expect(mock.count('anthropic')).toBe(1);

    const ctx = ctxFor(TENANT_A, result.correlationId as unknown as string);
    const invocations = await invocationAccounting.listByExecution(ctx, request.executionId);
    // Per-attempt accounting: one row for the failed openai attempt, one for the
    // successful anthropic attempt, both under the same llm_call_id.
    expect(invocations.length).toBe(2);
    const callIds = new Set(invocations.map((i) => i.llmCallId));
    expect(callIds.size).toBe(1);
    const byAttempt = [...invocations].sort((a, b) => a.attempt - b.attempt);
    expect(byAttempt[0].providerId).toBe('openai');
    expect(byAttempt[0].status).toBe('failed');
    expect(byAttempt[0].submitted).toBe(true);
    expect(byAttempt[1].providerId).toBe('anthropic');
    expect(byAttempt[1].status).toBe('success');
    expect(byAttempt[1].usageKnown).toBe(true);
    expect(byAttempt[1].totalTokens).toBe(46);
  });

  it('governance DENY: zero provider calls and zero invocation rows', async () => {
    policyClient.outcome = 'DENY';
    const request = buildRequest();
    const result = await agentExecutor.execute(request);

    expect(result.status).not.toBe('COMPLETED');
    // No HTTP request reached the mock — governance short-circuits before any LLM call.
    expect(mock.count()).toBe(0);

    const ctx = ctxFor(TENANT_A, request.correlationId as unknown as string);
    const invocations = await invocationAccounting.listByExecution(ctx, request.executionId);
    expect(invocations.length).toBe(0);
  });

  it('governance REQUIRE_APPROVAL without bound approval: AWAITING_APPROVAL, zero provider calls', async () => {
    policyClient.outcome = 'REQUIRE_APPROVAL';
    const request = buildRequest();
    const result = await agentExecutor.execute(request);

    expect(result.status).toBe('AWAITING_APPROVAL');
    expect(mock.count()).toBe(0);

    const ctx = ctxFor(TENANT_A, request.correlationId as unknown as string);
    const invocations = await invocationAccounting.listByExecution(ctx, request.executionId);
    expect(invocations.length).toBe(0);
  });

  it('governance REQUIRE_APPROVAL with a valid bound approval: proceeds past the gate', async () => {
    policyClient.outcome = 'REQUIRE_APPROVAL';
    const request = buildRequest();

    // Seed a real APPROVED approval bound to this executionId + idempotencyKey.
    const ctx = ctxFor(TENANT_A, request.correlationId as unknown as string);
    await postgresClient.withTenant(ctx, async (client) => {
      await client.query(
        `INSERT INTO mission.approvals (tenant_id, id, payload)
         VALUES ($1, $2, $3::jsonb)`,
        [
          TENANT_A,
          `approval-${request.executionId}`,
          JSON.stringify({
            executionId: request.executionId,
            idempotencyKey: request.idempotencyKey as unknown as string,
            status: 'APPROVED',
            actionType: 'agent_execution',
            createdAt: new Date().toISOString(),
            timeoutSeconds: 3600,
          }),
        ],
      );
    });

    const result = await agentExecutor.execute(request);
    // With a valid bound approval the executor proceeds to the LLM path.
    expect(mock.count()).toBeGreaterThan(0);
    expect(result.status).toBe('COMPLETED');
  });

  it('production specialist path: real SpecialistImplementationRegistry + ResearchSpecialist through the real chain', async () => {
    // Prove the real production execution chain end-to-end:
    //   AgentExecutor -> SpecialistImplementationRegistry -> ResearchSpecialist
    //   -> ProductionReasoningEngine -> LLMRouter -> real provider adapter
    //   -> local HTTP mock -> validated result -> reasoning artifact
    //   -> invocation accounting.
    // The specialist reasons only over the supplied reasoning output / context
    // (no fabricated external research data).
    const realExecutor = makeExecutor(
      new StaticAgentRegistry('specialist.research.v1'),
      new SpecialistImplementationRegistry(),
    );

    const request = buildRequest();
    const result = await realExecutor.execute(request);

    // Real provider adapter was invoked against the local mock.
    expect(mock.count()).toBeGreaterThan(0);
    expect(result.status).toBe('COMPLETED');
    // The ResearchSpecialist produced a validated outcome over the reasoning.
    expect(result.outcome.summary.length).toBeGreaterThan(0);
    expect(result.modelUsage.provider).toBeTruthy();

    const ctx = ctxFor(TENANT_A, result.correlationId as unknown as string);
    // Reasoning artifact persisted for the execution.
    const artifacts = await postgresClient.withTenant(ctx, async (client) =>
      client.query('SELECT * FROM ai_runtime.reasoning_artifacts WHERE execution_id = $1', [request.executionId]),
    );
    expect(artifacts.rowCount).toBeGreaterThan(0);
    // Invocation accounting recorded the real provider attempt(s).
    const invocations = await invocationAccounting.listByExecution(ctx, request.executionId);
    expect(invocations.length).toBeGreaterThan(0);
  });

  it('invalid structured output: repair loop then bounded fallback, artifact persisted', async () => {
    // Provider returns valid JSON missing required fields -> schema violation each time.
    mock.script.openai = { status: 200, content: INVALID_SCHEMA_REASONING, usage: { input: 10, output: 20 } };
    mock.script.anthropic = { status: 200, content: INVALID_SCHEMA_REASONING, usage: { input: 10, output: 20 } };

    const request = buildRequest();
    const result = await agentExecutor.execute(request);

    // The engine exhausts its bounded repair budget and returns a fallback artifact.
    const ctx = ctxFor(TENANT_A, result.correlationId as unknown as string);
    const artifacts = await postgresClient.withTenant(ctx, async (client) =>
      client.query('SELECT * FROM ai_runtime.reasoning_artifacts WHERE execution_id = $1', [request.executionId]),
    );
    expect(artifacts.rowCount).toBeGreaterThan(0);
    // Bounded: at most maxRetries+1 calls were made (no runaway repair loop).
    expect(mock.count()).toBeLessThanOrEqual(3);
    expect(mock.count()).toBeGreaterThan(0);
  });

  it('budget enforcement: unknown-usage failure reserves conservatively and blocks the fallback', async () => {
    // openai returns a submitted HTTP 500 (no usage parsed -> usage unknown).
    // The retained conservative estimate must count against the budget so the
    // anthropic fallback is blocked when it would exceed the cap.
    mock.script.openai = { status: 500 };
    mock.script.anthropic = { status: 200, content: VALID_REASONING, usage: { input: 12, output: 34 } };

    // maxTokens small enough that one conservative reservation consumes the budget.
    const request = buildRequest({ budget: { maxTokens: 40, maxCostUsd: 1, maxDurationSeconds: 60 } });
    const result = await agentExecutor.execute(request);

    // The fallback was blocked by the budget ledger before dispatching to anthropic.
    expect(mock.count('anthropic')).toBe(0);
    expect(result.status).not.toBe('COMPLETED');

    const ctx = ctxFor(TENANT_A, request.correlationId as unknown as string);
    const invocations = await invocationAccounting.listByExecution(ctx, request.executionId);
    const statuses = invocations.map((i) => i.status);
    expect(statuses).toContain('blocked_budget');
  });

  it('cross-tenant RLS: tenant B cannot read tenant A invocation rows', async () => {
    const request = buildRequest();
    const result = await agentExecutor.execute(request);
    expect(result.status).toBe('COMPLETED');

    const ctxA = ctxFor(TENANT_A, result.correlationId as unknown as string);
    const ctxB = ctxFor(TENANT_B, result.correlationId as unknown as string);

    const aRows = await invocationAccounting.listByExecution(ctxA, request.executionId);
    expect(aRows.length).toBeGreaterThan(0);

    // Tenant B sees nothing for tenant A's execution.
    const bRows = await invocationAccounting.listByExecution(ctxB, request.executionId);
    expect(bRows.length).toBe(0);

    const bArtifacts = await postgresClient.withTenant(ctxB, async (client) =>
      client.query('SELECT * FROM ai_runtime.reasoning_artifacts WHERE execution_id = $1', [request.executionId]),
    );
    expect(bArtifacts.rowCount).toBe(0);
  });
});
