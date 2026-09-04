import {
  ApprovalApplicationService,
  InMemoryApprovalRepository,
  InMemoryCompensationAdapter,
  InMemoryIdempotencyStore,
  InMemoryMissionRepository,
  InMemoryNotificationAdapter,
  MissionExecutionEngine,
  PostgresMissionRepository,
  PostgresExecutionApprovalBinding,
  planMissionActivity,
  replanMissionActivity,
  executeMissionStepActivity,
  executeTaskActivity,
  handleTaskResultActivity,
  evaluateCompletionActivity,
  checkpointActivity,
  setActivityEngineContext,
} from '@projectx/mission-orchestrator';
import type { TenantContext } from '@projectx/domain';
import type { IWorkflowClient, WorkflowExecutionRef, WorkflowStartOptions, WorkflowStartResult } from '@projectx/infrastructure';
import { NoOpTelemetry, PostgresAuditLog, PostgresClient } from '@projectx/infrastructure';
import { Pool } from 'pg';
import type { CorrelationId, TenantId, ToolCallRequest, ToolCallResult } from '@projectx/shared';
import { SpecialistImplementationRegistry } from '@projectx/specialist-agents';
import { asCorrelationId, asEventId, asIdempotencyKey } from '@projectx/shared';
import {
  AgentExecutor,
  ContextAssembler,
  InMemoryCheckpointStore,
  InMemoryMemoryRetriever,
  InMemoryKnowledgeRetriever,
  PolicyAwareDecisionEngine,
  ToolExecutor,
  StructuredOutputValidator,
  ProductionReasoningEngine,
  PostgresReasoningArtifactRepository,
  PostgresInvocationAccounting,
  type IReasoningEngine,
  type ReasoningRequest,
  type ReasoningOutput,
} from '@projectx/ai-runtime';
import {
  ControlPlaneAgentRegistry,
  ControlPlanePolicyClient,
  ControlPlaneModelCatalog,
  PolicyEvaluationService,
  PostgresAgentRepository,
  PostgresAuditSink,
  PostgresAutonomyRepository,
  PostgresCapabilityRepository,
  PostgresEmergencyStopProvider,
  PostgresModelRepository,
  PostgresPolicyRepository,
  type PostgresControlPlaneRepositoryConfig,
} from '@projectx/control-plane';
import { LLMRouter, ProviderRegistry, OpenAIProvider, AnthropicProvider } from '@projectx/llm-gateway';
import { EnvironmentSecretsProvider } from '@projectx/infrastructure';
import { StubMissionPlanner } from './stubs';

let counter = 0;
function generateId(): string {
  counter += 1;
  return `id-${counter}`;
}

class NoOpWorkflowClient implements IWorkflowClient {
  async start<TInput = unknown>(
    ctx: TenantContext,
    workflowType: string,
    _input: TInput,
    _options?: WorkflowStartOptions,
  ): Promise<WorkflowStartResult> {
    return {
      workflowId: 'noop',
      tenantId: ctx.tenantId as TenantId,
      correlationId: ctx.correlationId as CorrelationId,
      status: 'STARTED',
    };
  }

  async signal<TSignal = unknown>(
    _ctx: TenantContext,
    _ref: WorkflowExecutionRef,
    _signalName: string,
    _payload: TSignal,
  ): Promise<void> {}

  async query<TResult = unknown>(
    _ctx: TenantContext,
    _ref: WorkflowExecutionRef,
    _queryName: string,
  ): Promise<TResult> {
    return undefined as TResult;
  }

  async cancel(_ctx: TenantContext, _ref: WorkflowExecutionRef): Promise<void> {}
}

// Production requires the Control Plane database. No silent fallback to fake/stub policy or agent registries.
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the real AI Control Plane in production');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const postgresClient = new PostgresClient(pool);
const auditLog = new PostgresAuditLog({ pool });
const auditSink = new PostgresAuditSink(auditLog);

const repoConfig: PostgresControlPlaneRepositoryConfig = { client: postgresClient };
const agentRepository = new PostgresAgentRepository(repoConfig);
const capabilityRepository = new PostgresCapabilityRepository(repoConfig);
const policyRepository = new PostgresPolicyRepository(repoConfig);
const autonomyRepository = new PostgresAutonomyRepository(repoConfig);
const modelRepository = new PostgresModelRepository(repoConfig);
const emergencyStopProvider = new PostgresEmergencyStopProvider(repoConfig);

const modelCatalog = new ControlPlaneModelCatalog(modelRepository);

const secretsProvider = new EnvironmentSecretsProvider();
const providerRegistry = new ProviderRegistry();
providerRegistry.register(
  new OpenAIProvider({
    providerId: 'openai',
    baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com',
    secretName: process.env.OPENAI_SECRET_NAME ?? 'openai/api-key',
    secretProvider: secretsProvider,
    defaultModelId: process.env.OPENAI_DEFAULT_MODEL ?? 'gpt-4o-mini',
  }),
);
providerRegistry.register(
  new AnthropicProvider({
    providerId: 'anthropic',
    baseUrl: process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com',
    secretName: process.env.ANTHROPIC_SECRET_NAME ?? 'anthropic/api-key',
    secretProvider: secretsProvider,
    defaultModelId: process.env.ANTHROPIC_DEFAULT_MODEL ?? 'claude-3-haiku-20240307',
  }),
);

const reasoningArtifactRepository = new PostgresReasoningArtifactRepository(postgresClient);
const invocationAccounting = new PostgresInvocationAccounting(postgresClient);

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
  { defaultCapability: 'chat' },
);

const policyEvaluationService = new PolicyEvaluationService({
  emergencyStopProvider,
  policyRepository,
  autonomyRepository,
  auditSink,
});

const controlPlaneAgentRegistry = new ControlPlaneAgentRegistry({
  agentRepository,
  capabilityRepository,
});
const controlPlanePolicyClient = new ControlPlanePolicyClient({
  policyEvaluationService,
});

const productionReasoningEngine = new ProductionReasoningEngine({
  llmRouter,
  artifactRepository: reasoningArtifactRepository,
});

class NoopToolClient {
  async call(request: ToolCallRequest): Promise<ToolCallResult> {
    throw new Error(`No-op tool client cannot execute ${request.toolId}`);
  }
}

const agentExecutor = new AgentExecutor({
  agentRegistry: controlPlaneAgentRegistry,
  policyClient: controlPlanePolicyClient,
  contextAssembler: new ContextAssembler({
    memoryRetriever: new InMemoryMemoryRetriever(),
    knowledgeRetriever: new InMemoryKnowledgeRetriever(),
  }),
  memoryRetriever: new InMemoryMemoryRetriever(),
  knowledgeRetriever: new InMemoryKnowledgeRetriever(),
  reasoningEngine: productionReasoningEngine,
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
  implementationRegistry: new SpecialistImplementationRegistry(),
  approvalBinding: new PostgresExecutionApprovalBinding(postgresClient),
});

const missionRepository = new PostgresMissionRepository({ pool });
const approvalRepository = new InMemoryApprovalRepository();
const compensationPort = new InMemoryCompensationAdapter();
const notificationPort = new InMemoryNotificationAdapter();
const idempotencyStore = new InMemoryIdempotencyStore();

const approvalService = new ApprovalApplicationService({
  approvalRepository,
  workflowClient: new NoOpWorkflowClient(),
  notificationPort,
  generateEventId: () => asEventId(generateId()),
  generateCorrelationId: () => asCorrelationId(generateId()),
  generateApprovalId: () => generateId(),
});

const engine = new MissionExecutionEngine({
  missionRepository,
  agentExecutor,
  missionPlanner: new StubMissionPlanner(),
  agentRegistry: controlPlaneAgentRegistry,
  approvalService,
  eventBus: {
    publish: async () => {},
    sendCommand: async () => {},
    subscribe: async () => {},
  },
  compensationPort,
  generateEventId: () => asEventId(generateId()),
  generateCorrelationId: () => asCorrelationId(generateId()),
  generateIdempotencyKey: (hint: string) => asIdempotencyKey(`${hint}:${generateId()}`),
  generateExecutionId: () => generateId(),
  defaultTaskTimeoutSeconds: 60,
  maxTaskRetries: 3,
});

setActivityEngineContext(engine);

export {
  planMissionActivity,
  replanMissionActivity,
  executeMissionStepActivity,
  executeTaskActivity,
  handleTaskResultActivity,
  evaluateCompletionActivity,
  checkpointActivity,
};




