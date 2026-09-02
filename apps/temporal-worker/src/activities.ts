import {
  ApprovalApplicationService,
  InMemoryApprovalRepository,
  InMemoryCompensationAdapter,
  InMemoryIdempotencyStore,
  InMemoryMissionRepository,
  InMemoryNotificationAdapter,
  MissionExecutionEngine,
  planMissionActivity,
  executeTaskActivity,
  handleTaskResultActivity,
  evaluateCompletionActivity,
  checkpointActivity,
  setActivityEngineContext,
} from '@projectx/mission-orchestrator';
import type { TenantContext } from '@projectx/domain';
import type { IWorkflowClient, WorkflowExecutionRef, WorkflowStartOptions, WorkflowStartResult } from '@projectx/infrastructure';
import type { CorrelationId, TenantId } from '@projectx/shared';
import { asCorrelationId, asEventId, asIdempotencyKey } from '@projectx/shared';
import { StubAgentExecutor, StubAgentRegistry, StubMissionPlanner } from './stubs';

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

const missionRepository = new InMemoryMissionRepository();
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
  agentExecutor: new StubAgentExecutor(),
  missionPlanner: new StubMissionPlanner(),
  agentRegistry: new StubAgentRegistry(),
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
  executeTaskActivity,
  handleTaskResultActivity,
  evaluateCompletionActivity,
  checkpointActivity,
};
