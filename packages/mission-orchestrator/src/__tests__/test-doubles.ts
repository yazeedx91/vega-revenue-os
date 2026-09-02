import type { TenantContext } from '@projectx/domain';
import { Mission, type DomainEvent } from '@projectx/domain';
import { Actor } from '@projectx/domain';
import type { IAgentExecutor, IAgentRegistry, IPlanner } from '@projectx/ai-runtime';
import type { PlanningRequest } from '@projectx/ai-runtime';
import type {
  AgentContract,
  AIExecutionRequest,
  AIExecutionResult,
  CorrelationId,
  EventId,
  IdempotencyKey,
  PlanContract,
} from '@projectx/shared';
import type { IEventBus, IWorkflowClient, WorkflowExecutionRef, WorkflowStartOptions, WorkflowStartResult } from '@projectx/infrastructure';
import { asCorrelationId, asEventId, asIdempotencyKey, asMissionId, asTenantId, asUserId } from '@projectx/shared';

export function createTenantContext(tenantId: string, correlationId: string): TenantContext {
  return {
    tenantId: asTenantId(tenantId),
    correlationId: asCorrelationId(correlationId) as string,
  };
}

export function createTestMission(props?: { missionId?: string; tenantId?: string; status?: string }) {
  const tenantId = asTenantId(props?.tenantId ?? 'tenant-1');
  const missionId = asMissionId(props?.missionId ?? 'mission-1');
  const createResult = Mission.create(
    {
      id: missionId,
      tenantId,
      name: 'Test Mission',
      objective: 'Generate pipeline',
      icpId: 'icp-1',
      territory: ['US'],
      channels: ['email'],
      budget: { maxAiCostUsd: 100 },
      autonomyLevel: 0.5,
      constraints: {},
      successCriteria: { targetMeetings: 1 },
      deadline: new Date(Date.now() + 86400000),
      ownerUserId: asUserId('owner-1'),
      plan: {
        planId: `${missionId}-plan`,
        version: 1,
        objectives: [],
        phases: [],
        approvalGates: [],
        fallbackBranches: [],
      },
    },
    asCorrelationId('corr-create'),
    asEventId('evt-create'),
  );

  if (!createResult.success) {
    throw new Error(createResult.error.message);
  }
  const mission = createResult.value;
  mission.clearDomainEvents();

  if (props?.status && props.status !== 'DRAFT') {
    const actor = Actor.human(asUserId('owner-1'), tenantId);
    if (
      props.status === 'APPROVED' ||
      props.status === 'PLANNING' ||
      props.status === 'EXECUTING' ||
      props.status === 'PAUSED'
    ) {
      mission.approve(actor, asCorrelationId('corr-approve'), asEventId('evt-approve'));
      mission.clearDomainEvents();
    }
    if (
      props.status === 'PLANNING' ||
      props.status === 'EXECUTING' ||
      props.status === 'PAUSED'
    ) {
      mission.start(asCorrelationId('corr-start'), asEventId('evt-start'));
      mission.clearDomainEvents();
    }
    if (props.status === 'EXECUTING' || props.status === 'PAUSED') {
      mission.planValid(asCorrelationId('corr-plan'), asEventId('evt-plan'));
      mission.clearDomainEvents();
    }
    if (props.status === 'PAUSED') {
      mission.pause('test pause', asCorrelationId('corr-pause'), asEventId('evt-pause'));
      mission.clearDomainEvents();
    }
  }

  return mission;
}

export class FakeEventBus implements IEventBus {
  readonly published: DomainEvent<unknown>[] = [];

  async publish<TPayload>(event: DomainEvent<TPayload>): Promise<void> {
    this.published.push(event);
  }

  async sendCommand(): Promise<void> {}
  async subscribe(): Promise<void> {}
}

export class FakeWorkflowClient implements IWorkflowClient {
  readonly started: Array<{ ctx: TenantContext; workflowType: string; input: unknown; options?: WorkflowStartOptions }> = [];
  readonly signaled: Array<{ ctx: TenantContext; ref: WorkflowExecutionRef; signalName: string; payload: unknown }> = [];
  readonly cancelled: Array<{ ctx: TenantContext; ref: WorkflowExecutionRef }> = [];

  async start<TInput>(ctx: TenantContext, workflowType: string, input: TInput, options?: WorkflowStartOptions): Promise<WorkflowStartResult> {
    this.started.push({ ctx, workflowType, input: input as unknown, options });
    return {
      workflowId: `wf:${workflowType}:${ctx.tenantId}`,
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId as CorrelationId,
      status: 'STARTED',
    };
  }

  async signal<TSignal>(ctx: TenantContext, ref: WorkflowExecutionRef, signalName: string, payload: TSignal): Promise<void> {
    this.signaled.push({ ctx, ref, signalName, payload: payload as unknown });
  }

  async query<TResult = unknown>(_ctx: TenantContext, _ref: WorkflowExecutionRef, _queryName: string): Promise<TResult> {
    return undefined as TResult;
  }

  async cancel(ctx: TenantContext, ref: WorkflowExecutionRef): Promise<void> {
    this.cancelled.push({ ctx, ref });
  }
}

export class FakeAgentExecutor implements IAgentExecutor {
  private status: AIExecutionResult['status'] = 'COMPLETED';

  setStatus(status: AIExecutionResult['status']): void {
    this.status = status;
  }

  async execute(request: AIExecutionRequest): Promise<AIExecutionResult> {
    return {
      executionId: request.executionId,
      tenantId: request.tenantId,
      missionId: request.missionId,
      status: this.status,
      outcome: {
        summary: `Stub ${this.status}`,
        decisions: [],
        actions: [],
        evidence: [],
      },
      modelUsage: { model: 'stub', inputTokens: 0, outputTokens: 0, costUsd: 0 },
      startedAt: new Date(),
      completedAt: new Date(),
      correlationId: request.correlationId,
      events: [],
    };
  }
}

export class FakeAgentRegistry implements IAgentRegistry {
  async getAgent(_ctx: TenantContext, agentId: string, _version?: string): Promise<AgentContract | null> {
    if (agentId !== 'agent-1') return null;
    return {
      agentId: 'agent-1',
      name: 'Fake Agent',
      role: 'researcher',
      description: 'Fake',
      capabilities: ['research'],
      tools: [],
      policies: [],
      modelPolicy: { preferredModelFamily: 'stub', maxCostPerTaskUsd: 1, maxTokensPerTask: 1000 },
      memoryPolicy: { read: [], write: [], validationRequired: false },
      knowledgePolicy: { read: [], write: [] },
      autonomyLevelDefault: 0.5,
      evaluationPolicy: { criteria: [], minScore: 0 },
      lifecycle: 'ACTIVE',
      owner: 'system',
      version: '1.0.0',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async getCapability(): Promise<{ capabilityId: string; allowedTools: string[] } | null> {
    return { capabilityId: 'research', allowedTools: [] };
  }
}

export class FakePlanner implements IPlanner {
  async plan(_ctx: TenantContext, request: PlanningRequest): Promise<PlanContract> {
    const mission = request.mission;
    const task1Id = `${mission.missionId}-task-1`;
    const task2Id = `${mission.missionId}-task-2`;
    return {
      planId: `${mission.missionId}-plan`,
      missionId: mission.missionId,
      version: 1,
      objectives: [mission.objective],
      phases: [
        {
          phaseId: `${mission.missionId}-phase-1`,
          name: 'Research',
          tasks: [
            {
              taskId: task1Id,
              missionId: mission.missionId,
              planId: `${mission.missionId}-plan`,
              agentId: 'agent-1',
              agentVersion: '1.0.0',
              taskType: 'research',
              status: 'PENDING',
              input: {},
              dependsOn: [],
              approvalGateId: null,
            },
            {
              taskId: task2Id,
              missionId: mission.missionId,
              planId: `${mission.missionId}-plan`,
              agentId: 'agent-1',
              agentVersion: '1.0.0',
              taskType: 'research',
              status: 'PENDING',
              input: {},
              dependsOn: [task1Id],
              approvalGateId: null,
            },
          ],
        },
      ],
      approvalGates: [],
      fallbackBranches: [],
    };
  }
}

export function createMissionIdGenerator(): () => EventId {
  let counter = 0;
  return () => {
    counter += 1;
    return asEventId(`evt-${counter}`);
  };
}

export function createCorrelationIdGenerator(): () => CorrelationId {
  let counter = 0;
  return () => {
    counter += 1;
    return asCorrelationId(`corr-${counter}`);
  };
}

export function createIdempotencyKeyGenerator(): (hint: string) => IdempotencyKey {
  return (hint: string) => asIdempotencyKey(hint);
}
