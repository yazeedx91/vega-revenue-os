import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import type { TenantContext } from '@projectx/domain';
import { PostgresClient } from '@projectx/infrastructure';
import { NoOpTelemetry } from '@projectx/infrastructure';
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
import {
  ControlPlaneAgentRegistry,
  ControlPlaneModelCatalog,
  ControlPlanePolicyClient,
  PolicyEvaluationService,
  PostgresAgentRepository,
  PostgresAuditSink,
  PostgresAutonomyRepository,
  PostgresCapabilityRepository,
  PostgresEmergencyStopProvider,
  PostgresModelRepository,
  PostgresPolicyRepository,
  SystemAgentsSeed,
} from '@projectx/control-plane';
import { ProviderRegistry, LLMRouter, LLMProviderError } from '@projectx/llm-gateway';
import type { ILLMProvider, LLMProviderRequest, LLMProviderResult } from '@projectx/llm-gateway';
import { SpecialistImplementationRegistry } from '@projectx/specialist-agents';
import { PostgresAuditLog } from '@projectx/infrastructure';
import { asCorrelationId, asIdempotencyKey, asTenantId, asUserId } from '@projectx/shared';
import type { AIExecutionRequest, CorrelationId, TenantId, ToolCallRequest, ToolCallResult } from '@projectx/shared';
import { connectPostgres, runMigrations } from './helpers';

const TENANT_A = 'tenant-a';

class FakeLLMProvider implements ILLMProvider {
  readonly capabilities = ['reasoning', 'chat'] as const;
  public ready = true;
  public failWith?: { code: string; retryable: boolean; message: string };

  constructor(public readonly providerId: string, private readonly modelId: string, private readonly response: unknown) {}

  async checkReadiness(): Promise<void> {
    if (!this.ready) {
      throw new LLMProviderError(
        `${this.providerId} not ready`,
        this.providerId,
        'MISSING_SECRET',
        false,
      );
    }
  }

  async invoke(request: LLMProviderRequest): Promise<LLMProviderResult> {
    if (this.failWith) {
      throw new LLMProviderError(this.failWith.message, this.providerId, this.failWith.code, this.failWith.retryable);
    }

    const startedAt = new Date();
    const completedAt = new Date();
    return {
      providerId: this.providerId,
      modelId: this.modelId,
      providerRequestId: `req-${this.providerId}-${randomUUID()}`,
      content: JSON.stringify(this.response),
      structured: this.response as Record<string, unknown>,
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      costUsd: 0.00005,
      latencyMs: 150,
      finishReason: 'stop',
      startedAt,
      completedAt,
    };
  }
}

class NoopToolClient {
  async call(request: ToolCallRequest): Promise<ToolCallResult> {
    throw new Error(`No-op tool client cannot execute ${request.toolId}`);
  }
}

describe('Slice 5 LLM Runtime E2E', () => {
  let pool: Pool;
  let postgresClient: PostgresClient;
  let agentExecutor: AgentExecutor;
  let agentRegistry: ControlPlaneAgentRegistry;
  let invocationAccounting: PostgresInvocationAccounting;

  beforeAll(async () => {
    await runMigrations();
    pool = await connectPostgres();
    postgresClient = new PostgresClient(pool);

    const auditLog = new PostgresAuditLog({ pool });
    const auditSink = new PostgresAuditSink(auditLog);
    const repoConfig = { client: postgresClient };

    const agentRepo = new PostgresAgentRepository(repoConfig);
    const capabilityRepo = new PostgresCapabilityRepository(repoConfig);
    const policyRepo = new PostgresPolicyRepository(repoConfig);
    const autonomyRepo = new PostgresAutonomyRepository(repoConfig);
    const emergencyStopProvider = new PostgresEmergencyStopProvider(repoConfig);
    const modelRepository = new PostgresModelRepository(repoConfig);

    invocationAccounting = new PostgresInvocationAccounting(postgresClient);

    const modelCatalog = new ControlPlaneModelCatalog(modelRepository);

    const policyEvaluation = new PolicyEvaluationService({
      emergencyStopProvider,
      policyRepository: policyRepo,
      autonomyRepository: autonomyRepo,
      auditSink,
    });

    agentRegistry = new ControlPlaneAgentRegistry({
      agentRepository: agentRepo,
      capabilityRepository: capabilityRepo,
    });
    const policyClient = new ControlPlanePolicyClient({ policyEvaluationService: policyEvaluation });

    const memory = new InMemoryMemoryRetriever();
    const knowledge = new InMemoryKnowledgeRetriever();
    const assembler = new ContextAssembler({ memoryRetriever: memory, knowledgeRetriever: knowledge });

    const reasoningArtifactRepository = new PostgresReasoningArtifactRepository(postgresClient);

    const seed = new SystemAgentsSeed({
      agentRepository: agentRepo,
      controlPlane: {
        agentRepository: agentRepo,
        capabilityRepository: capabilityRepo,
        modelRepository,
        policyRepository: policyRepo,
        autonomyRepository: autonomyRepo,
        auditSink,
      },
      lifecycle: { agentRepository: agentRepo, auditSink },
    });
    await seed.seed({ tenantId: asTenantId('system'), correlationId: asCorrelationId(randomUUID()) } as TenantContext);

    // Seed two models to exercise cross-provider fallback at the catalog level.
    await modelRepository.saveModel({ tenantId: asTenantId('system') } as TenantContext, {
      modelId: 'gpt-4o-mini',
      provider: 'openai',
      family: 'gpt',
      capabilities: ['reasoning', 'chat'],
      latencyClass: 'background',
      costMetadata: { costPerInputTokenUsd: 5e-7, costPerOutputTokenUsd: 1.5e-6, priority: 1 },
      healthMetadata: { supportsStructuredOutput: true, maxContextTokens: 128_000, lifecycle: 'ACTIVE', priority: 1 },
    });
    await modelRepository.saveModel({ tenantId: asTenantId('system') } as TenantContext, {
      modelId: 'claude-3-haiku-20240307',
      provider: 'anthropic',
      family: 'claude',
      capabilities: ['reasoning', 'chat'],
      latencyClass: 'background',
      costMetadata: { costPerInputTokenUsd: 8e-7, costPerOutputTokenUsd: 2.5e-6, priority: 2 },
      healthMetadata: { supportsStructuredOutput: true, maxContextTokens: 200_000, lifecycle: 'ACTIVE', priority: 2 },
    });

    // AgentExecutor path: primary provider is openai, but it is not ready to force fallback.
    const openaiProvider = new FakeLLMProvider('openai', 'gpt-4o-mini', {});
    openaiProvider.ready = false;

    const anthropicProvider = new FakeLLMProvider('anthropic', 'claude-3-haiku-20240307', {
      rationale: 'External research data is not available yet.',
      conclusion: 'Planned company research for target Acme. Real data collection deferred to Slice 8 research tools.',
      confidence: 0.95,
      evidence: ['Input validation passed', 'Requested research scope is company'],
      proposedActions: [
        {
          actionId: 'a-1',
          capability: 'research',
          toolId: 'request_tool',
          toolVersion: '1.0.0',
          input: { toolCategory: 'research', slice: 8 },
          rationale: 'Research data belongs to Slice 8 tools; do not fabricate.',
          riskCategory: 'LOW',
        },
      ],
    });

    const providerRegistry = new ProviderRegistry();
    providerRegistry.register(openaiProvider);
    providerRegistry.register(anthropicProvider);

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
            providerId: event.providerId,
            modelId: event.modelId,
            providerRequestId: 'unknown',
            capability: 'reasoning',
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            totalTokens: event.totalTokens,
            costUsd: event.costUsd,
            latencyMs: event.latencyMs,
            correlationId: event.correlationId,
            idempotencyKey: event.idempotencyKey,
            recordedAt: new Date(),
          },
        );
      },
      { defaultCapability: 'reasoning' },
    );

    const reasoningEngine = new ProductionReasoningEngine({
      llmRouter,
      artifactRepository: reasoningArtifactRepository,
    });

    agentExecutor = new AgentExecutor({
      agentRegistry,
      implementationRegistry: new SpecialistImplementationRegistry(),
      policyClient,
      contextAssembler: assembler,
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
    });
  });

  afterAll(async () => {
    if (postgresClient) await postgresClient.end();
  });

  it('cross-provider fallback: executes a research task via anthropic when openai is not ready, persists artifacts and invocations', async () => {
    const executionId = `exec-slice5-${randomUUID()}`;
    const request: AIExecutionRequest = {
      executionId,
      tenantId: asTenantId(TENANT_A),
      missionId: 'mission-slice5',
      agentId: 'research-agent',
      agentVersion: '1.0.0',
      taskId: `task-research`,
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
      budget: { maxTokens: 1000, maxCostUsd: 1, maxDurationSeconds: 60 },
      idempotencyKey: asIdempotencyKey(`idem-slice5-${randomUUID()}`),
      metadata: {},
    };

    const result = await agentExecutor.execute(request);

    expect(result.status).toBe('COMPLETED');
    expect(result.tenantId).toBe(asTenantId(TENANT_A));
    expect(result.modelUsage).toBeDefined();
    expect(result.modelUsage.provider).toBe('anthropic');
    expect(result.modelUsage.inputTokens).toBeGreaterThan(0);
    expect(result.modelUsage.outputTokens).toBeGreaterThan(0);
    expect(result.modelUsage.costUsd).toBeGreaterThan(0);

    const ctx: TenantContext = { tenantId: asTenantId(TENANT_A), correlationId: result.correlationId as CorrelationId };

    const invocations = await invocationAccounting.listByExecution(ctx, executionId);
    expect(invocations.length).toBeGreaterThan(0);
    expect(invocations[0].providerId).toBe('anthropic');
    expect(invocations[0].costUsd).toBeGreaterThan(0);

    const reasoningArtifacts = await postgresClient.withTenant(ctx, async (client) =>
      client.query('SELECT * FROM ai_runtime.reasoning_artifacts WHERE execution_id = $1', [executionId]),
    );
    expect(reasoningArtifacts.rowCount).toBeGreaterThan(0);
    expect(reasoningArtifacts.rows[0].provider_id).toBe('anthropic');
    expect(reasoningArtifacts.rows[0].proposed_actions).toBeDefined();
    expect((reasoningArtifacts.rows[0].proposed_actions as unknown[])?.length).toBe(1);
  });
});
