import {
  ApprovalApplicationService,
  InMemoryApprovalRepository,
  InMemoryCompensationAdapter,
  InMemoryIdempotencyStore,
  InMemoryMissionRepository,
  InMemoryNotificationAdapter,
  MissionExecutionEngine,
  PostgresMissionRepository,
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
  type IReasoningEngine,
  type ReasoningRequest,
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
  PostgresModelRepository,
  PostgresPolicyRepository,
  type PostgresControlPlaneRepositoryConfig,
} from '@projectx/control-plane';
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

class DeterministicReasoningEngine implements IReasoningEngine {
  async reason(_ctx: TenantContext, _request: ReasoningRequest): Promise<ReasoningOutput> {
    return {
      rationale: 'Slice 3 deterministic reasoning: Control Plane policy will govern the execution.',
      conclusion: 'proceed',
      confidence: 0.9,
      evidence: [],
      requiredApprovals: [],
      proposedActions: [],
    };
  }
}

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
  reasoningEngine: new DeterministicReasoningEngine(),
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




