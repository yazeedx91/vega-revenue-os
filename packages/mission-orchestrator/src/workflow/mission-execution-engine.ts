import { Actor, ensureSameTenant, type Mission, type MissionTask, type MissionId, type TaskId, type TenantContext } from '@projectx/domain';
import type {
  AIExecutionRequest,
  AIExecutionResult,
  CorrelationId,
  EventId,
  ExecutionBudget,
  ExecutionPolicyContext,
  IdempotencyKey,
  PlanContract,
  TaskContract,
} from '@projectx/shared';
import type { IEventBus } from '@projectx/infrastructure';
import type { IAgentExecutor, IAgentRegistry, IPlanner } from '@projectx/ai-runtime';
import type { IMissionRepository } from '../ports/mission-repository.interface';
import type { ICompensationPort } from '../ports/compensation-port.interface';
import type { ApprovalApplicationService } from '../application/approval-application.service';
import { mapMissionToContract } from './mission-mapper';

export interface MissionExecutionEngineDependencies {
  missionRepository: IMissionRepository;
  agentExecutor: IAgentExecutor;
  missionPlanner: IPlanner;
  agentRegistry: IAgentRegistry;
  approvalService: ApprovalApplicationService;
  eventBus: IEventBus;
  compensationPort: ICompensationPort;
  generateEventId: () => EventId;
  generateCorrelationId: () => CorrelationId;
  generateIdempotencyKey: (hint: string) => IdempotencyKey;
  generateExecutionId: () => string;
  defaultTaskTimeoutSeconds: number;
  maxTaskRetries: number;
}

export class MissionExecutionEngine {
  constructor(private readonly deps: MissionExecutionEngineDependencies) {}

  async executeMission(ctx: TenantContext, missionId: string): Promise<void> {
    await this.planMission(ctx, missionId);

    let iterations = 0;
    const maxIterations = 1000;

    while (iterations < maxIterations) {
      iterations += 1;
      const mission = await this.loadMission(ctx, missionId);

      if (this.isTerminal(mission.status)) {
        break;
      }

      if (mission.status !== 'EXECUTING') {
        break;
      }

      const nextTask = this.selectNextTask(mission);
      if (!nextTask) {
        await this.evaluateCompletion(ctx, mission);
        break;
      }

      await this.executeTask(ctx, mission, nextTask);
    }
  }

  async planMission(ctx: TenantContext, missionId: string): Promise<void> {
    const mission = await this.loadMission(ctx, missionId);
    if (mission.status !== 'PLANNING') {
      throw new Error(`Mission ${missionId} is not in PLANNING state`);
    }

    const contract = mapMissionToContract(mission);
    const correlationId = this.deps.generateCorrelationId();
    const availableAgents = await this.loadAvailableAgents(ctx);

    const plan = await this.deps.missionPlanner.plan(ctx, {
      mission: contract,
      availableAgents,
      correlationId,
      idempotencyKey: this.deps.generateIdempotencyKey(`plan:${missionId}`),
    });

    for (const taskContract of this.flattenTasks(plan)) {
      const taskResult = mission.addTask(
        {
          id: taskContract.taskId as unknown as TaskId,
          missionId: taskContract.missionId as unknown as MissionId,
          planId: taskContract.planId,
          agentId: taskContract.agentId,
          agentVersion: taskContract.agentVersion,
          taskType: taskContract.taskType,
          input: taskContract.input,
          dependsOn: taskContract.dependsOn as unknown as TaskId[],
          deadline: taskContract.deadline,
          approvalGateId: taskContract.approvalGateId ?? undefined,
          idempotencyKey: this.deps.generateIdempotencyKey(`task:${taskContract.taskId}`),
          correlationId,
          actor: Actor.system('mission-planner', ctx.tenantId),
        },
        correlationId,
        this.deps.generateEventId(),
      );
      if (!taskResult.success) {
        throw new Error(`Cannot add task ${taskContract.taskId}: ${taskResult.error.message}`);
      }
    }

    const planValidResult = mission.planValid(
      this.deps.generateCorrelationId(),
      this.deps.generateEventId(),
    );
    if (!planValidResult.success) {
      throw new Error(`Cannot mark plan valid: ${planValidResult.error.message}`);
    }

    await this.saveAndPublish(ctx, mission);
  }

  async runTask(ctx: TenantContext, mission: Mission, task: MissionTask): Promise<AIExecutionResult> {
    const startResult = mission.startTask(
      task.id,
      this.deps.generateCorrelationId(),
      this.deps.generateEventId(),
    );
    if (!startResult.success) {
      throw new Error(`Cannot start task ${task.id}: ${startResult.error.message}`);
    }
    await this.saveAndPublish(ctx, mission);

    const executionId = this.deps.generateExecutionId();
    const request = this.buildExecutionRequest(ctx, mission, task, executionId);
    return this.deps.agentExecutor.execute(request);
  }

  async executeTask(ctx: TenantContext, mission: Mission, task: MissionTask): Promise<void> {
    const result = await this.runTask(ctx, mission, task);
    await this.handleTaskResult(ctx, mission, task, result);
  }

  async executeMissionStep(
    ctx: TenantContext,
    missionId: string,
  ): Promise<{ missionId: string; status: Mission['status']; completedTaskId?: string }> {
    const mission = await this.loadMission(ctx, missionId);
    if (this.isTerminal(mission.status)) {
      return { missionId, status: mission.status };
    }
    if (mission.status !== 'EXECUTING') {
      return { missionId, status: mission.status };
    }
    const nextTask = this.selectNextTask(mission);
    if (!nextTask) {
      await this.evaluateCompletion(ctx, mission);
      return { missionId, status: mission.status };
    }
    await this.executeTask(ctx, mission, nextTask);
    return { missionId, status: mission.status, completedTaskId: nextTask.id as string };
  }

  async handleTaskResult(
    ctx: TenantContext,
    mission: Mission,
    task: MissionTask,
    result: AIExecutionResult,
  ): Promise<void> {
    ensureSameTenant(ctx, mission.tenantId);

    if (result.status === 'COMPLETED') {
      const completeResult = mission.completeTask(
        task.id,
        result.outcome,
        this.deps.generateCorrelationId(),
        this.deps.generateEventId(),
      );
      if (!completeResult.success) {
        throw new Error(`Cannot complete task ${task.id}: ${completeResult.error.message}`);
      }
    } else if (result.status === 'AWAITING_APPROVAL') {
      await this.requestApproval(ctx, mission, task, result);
    } else if (result.status === 'FAILED' || result.status === 'TIMED_OUT' || result.status === 'CANCELLED') {
      const failResult = mission.failTask(
        task.id,
        result.outcome.summary,
        this.deps.generateCorrelationId(),
        this.deps.generateEventId(),
      );
      if (!failResult.success) {
        throw new Error(`Cannot fail task ${task.id}: ${failResult.error.message}`);
      }

      await this.compensateIfNeeded(ctx, mission, task, result);

      const blockResult = mission.block(
        `Task ${task.id} failed: ${result.outcome.summary}`,
        this.deps.generateCorrelationId(),
        this.deps.generateEventId(),
      );
      if (!blockResult.success) {
        throw new Error(`Cannot block mission: ${blockResult.error.message}`);
      }
    }

    await this.saveAndPublish(ctx, mission);
  }

  async evaluateCompletion(ctx: TenantContext, mission: Mission): Promise<void> {
    const allTasksCompleted = mission.tasks.every((t) => t.status === 'COMPLETED');
    if (allTasksCompleted) {
      const result = mission.complete(
        { meetingsBooked: 0, opportunitiesCreated: 0 },
        this.deps.generateCorrelationId(),
        this.deps.generateEventId(),
      );
      if (!result.success) {
        throw new Error(`Cannot complete mission: ${result.error.message}`);
      }
    } else {
      const result = mission.fail(
        'No runnable tasks remain and not all tasks completed',
        this.deps.generateCorrelationId(),
        this.deps.generateEventId(),
      );
      if (!result.success) {
        throw new Error(`Cannot fail mission: ${result.error.message}`);
      }
    }
    await this.saveAndPublish(ctx, mission);
  }

  private async requestApproval(
    ctx: TenantContext,
    mission: Mission,
    task: MissionTask,
    result: AIExecutionResult,
  ): Promise<void> {
    const markResult = mission.markTaskAwaitingApproval(
      task.id,
      `approval:${task.id}`,
      this.deps.generateCorrelationId(),
      this.deps.generateEventId(),
    );
    if (!markResult.success) {
      throw new Error(`Cannot mark task awaiting approval: ${markResult.error.message}`);
    }

    await this.deps.approvalService.requestApproval(ctx, {
      missionId: mission.id,
      taskId: task.id,
      executionId: result.executionId,
      actionType: task.taskType,
      riskCategory: 'MEDIUM',
      proposedAction: result.outcome.actions,
      evidence: result.outcome.evidence,
      reasoning: result.outcome.summary,
      confidence: 0.9,
      requestedBy: task.agentId,
      approverRole: 'mission-owner',
      timeoutSeconds: this.deps.defaultTaskTimeoutSeconds,
      idempotencyKey: this.deps.generateIdempotencyKey(`approval:${task.id}`),
    });

    const pauseResult = mission.pause(
      `Awaiting approval for task ${task.id}`,
      this.deps.generateCorrelationId(),
      this.deps.generateEventId(),
    );
    if (!pauseResult.success) {
      throw new Error(`Cannot pause mission for approval: ${pauseResult.error.message}`);
    }
  }

  private async compensateIfNeeded(
    ctx: TenantContext,
    mission: Mission,
    task: MissionTask,
    _result: AIExecutionResult,
  ): Promise<void> {
    await this.deps.compensationPort.execute(ctx, {
      compensationId: `comp:${mission.id}:${task.id}`,
      missionId: mission.id,
      taskId: task.id,
      actionType: task.taskType,
      payload: { reason: 'Task failure compensation' },
    });
  }

  private selectNextTask(mission: Mission): MissionTask | undefined {
    const completedIds = new Set(
      mission.tasks.filter((t) => t.status === 'COMPLETED').map((t) => t.id),
    );
    return mission.tasks.find(
      (t) =>
        t.status === 'PENDING' &&
        t.dependsOn.every((depId) => completedIds.has(depId)),
    );
  }

  private async loadAvailableAgents(ctx: TenantContext) {
    const agentIds = ['agent-1', 'outreach-orchestrator'];
    const agents: Awaited<ReturnType<IAgentRegistry['getAgent']>>[] = [];
    for (const agentId of agentIds) {
      const agent = await this.deps.agentRegistry.getAgent(ctx, agentId);
      if (agent) agents.push(agent);
    }
    return agents.filter((a): a is NonNullable<typeof a> => a !== null);
  }

  private buildExecutionRequest(
    ctx: TenantContext,
    mission: Mission,
    task: MissionTask,
    executionId: string,
  ): AIExecutionRequest {
    const budget: ExecutionBudget = {
      maxTokens: 10000,
      maxCostUsd: mission.budget.maxAiCostUsd,
      maxDurationSeconds: this.deps.defaultTaskTimeoutSeconds,
    };
    const policyContext: ExecutionPolicyContext = {
      autonomyLevel: mission.autonomyLevel,
      riskCategory: 'MEDIUM',
      tenantPolicyVersion: '1.0.0',
      missionPolicyVersion: '1.0.0',
    };

    return {
      executionId,
      tenantId: ctx.tenantId,
      missionId: mission.id,
      agentId: task.agentId,
      agentVersion: task.agentVersion,
      taskId: task.id,
      taskType: task.taskType,
      correlationId: ctx.correlationId as CorrelationId,
      context: {
        mission: mapMissionToContract(mission) as unknown as Record<string, unknown>,
        target: task.input as Record<string, unknown>,
      },
      capabilities: ['research'],
      policyContext,
      budget,
      deadline: task.deadline ?? mission.deadline,
      idempotencyKey: this.deps.generateIdempotencyKey(`exec:${executionId}`),
      metadata: { source: 'mission-orchestrator' },
    };
  }

  private async loadMission(ctx: TenantContext, missionId: string): Promise<Mission> {
    const mission = await this.deps.missionRepository.findById(ctx, missionId);
    if (!mission) {
      throw new Error(`Mission ${missionId} not found`);
    }
    ensureSameTenant(ctx, mission.tenantId);
    return mission;
  }

  private async saveAndPublish(ctx: TenantContext, mission: Mission): Promise<void> {
    await this.deps.missionRepository.save(ctx, mission);
    for (const event of mission.domainEvents) {
      await this.deps.eventBus.publish(event);
    }
    mission.clearDomainEvents();
  }

  private flattenTasks(plan: PlanContract): TaskContract[] {
    return plan.phases.flatMap((phase) => phase.tasks);
  }

  private isTerminal(status: string): boolean {
    return ['COMPLETED', 'FAILED', 'CANCELLED', 'ARCHIVED'].includes(status);
  }
}
