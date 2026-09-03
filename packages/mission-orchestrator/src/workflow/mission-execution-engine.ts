import { Actor, ensureSameTenant, type Mission, type MissionTask, type MissionPlan, type MissionTaskProps, type MissionId, type TaskId, type TenantContext } from '@projectx/domain';
import type {
  AgentContract,
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
import { ConcurrencyConflictError } from '@projectx/infrastructure';
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

    const { plan } = await this.buildPlan(ctx, mission);
    const correlationId = this.deps.generateCorrelationId();

    for (const taskContract of this.flattenTasks(plan)) {
      await this.validateCapability(ctx, taskContract);
      const taskResult = mission.addTask(
        this.mapTaskContractToProps(mission, taskContract, plan.planId, correlationId),
        correlationId,
        this.deps.generateEventId(),
      );
      if (!taskResult.success) {
        throw new Error(`Cannot add task ${taskContract.taskId}: ${taskResult.error.message}`);
      }
    }

    mission.plan = plan as unknown as MissionPlan;

    const planValidResult = mission.planValid(
      this.deps.generateCorrelationId(),
      this.deps.generateEventId(),
    );
    if (!planValidResult.success) {
      throw new Error(`Cannot mark plan valid: ${planValidResult.error.message}`);
    }

    await this.saveAndPublish(ctx, mission, async (m) => {
      for (const taskContract of this.flattenTasks(plan)) {
        await this.validateCapability(ctx, taskContract);
        const taskResult = m.addTask(
          this.mapTaskContractToProps(m, taskContract, plan.planId, correlationId),
          correlationId,
          this.deps.generateEventId(),
        );
        if (!taskResult.success) {
          throw new Error(`Cannot add task ${taskContract.taskId}: ${taskResult.error.message}`);
        }
      }
      m.plan = plan as unknown as MissionPlan;
      const validResult = m.planValid(this.deps.generateCorrelationId(), this.deps.generateEventId());
      if (!validResult.success) {
        throw new Error(`Cannot mark plan valid: ${validResult.error.message}`);
      }
    });
  }

  async replanMission(ctx: TenantContext, missionId: string, newPlan?: PlanContract): Promise<void> {
    const mission = await this.loadMission(ctx, missionId);
    if (this.isTerminal(mission.status)) {
      throw new Error(`Cannot replan terminal mission ${missionId}`);
    }

    const plan = newPlan ? newPlan : (await this.buildPlan(ctx, mission)).plan;
    const correlationId = this.deps.generateCorrelationId();

    const taskProps: MissionTaskProps[] = [];
    for (const taskContract of this.flattenTasks(plan)) {
      await this.validateCapability(ctx, taskContract);
      taskProps.push(this.mapTaskContractToProps(mission, taskContract, plan.planId, correlationId));
    }

    const replanResult = mission.replan(
      plan as unknown as MissionPlan,
      taskProps,
      this.deps.generateCorrelationId(),
      this.deps.generateEventId(),
    );
    if (!replanResult.success) {
      throw new Error(`Cannot replan mission ${missionId}: ${replanResult.error.message}`);
    }

    await this.saveAndPublish(ctx, mission, async (m) => {
      const reResult = m.replan(
        plan as unknown as MissionPlan,
        taskProps,
        this.deps.generateCorrelationId(),
        this.deps.generateEventId(),
      );
      if (!reResult.success) {
        throw new Error(`Cannot replan mission ${missionId}: ${reResult.error.message}`);
      }
    });
  }

  async runTask(ctx: TenantContext, mission: Mission, task: MissionTask): Promise<AIExecutionResult> {
    const executionId = this.deps.generateExecutionId();
    const pausedResult = (): AIExecutionResult => ({
      executionId,
      tenantId: ctx.tenantId,
      missionId: mission.id as string,
      status: 'PAUSED',
      outcome: {
        summary: 'Mission is no longer executing; aborting task execution',
        decisions: [],
        actions: [],
        evidence: [],
      },
      modelUsage: {
        model: 'none',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      },
      startedAt: new Date(),
      completedAt: new Date(),
      correlationId: ctx.correlationId as CorrelationId,
      events: [],
    });

    if (mission.status !== 'EXECUTING') {
      const latestTask = mission.tasks.find((t) => t.id === task.id);
      if (!latestTask || latestTask.status !== 'RUNNING') {
        return pausedResult();
      }
    }

    const startResult = mission.startTask(
      task.id,
      this.deps.generateCorrelationId(),
      this.deps.generateEventId(),
    );
    if (!startResult.success) {
      throw new Error(`Cannot start task ${task.id}: ${startResult.error.message}`);
    }
    mission = await this.saveAndPublish(ctx, mission, async (m) => {
      const r = m.startTask(task.id, this.deps.generateCorrelationId(), this.deps.generateEventId());
      if (!r.success) {
        throw new Error(`Cannot start task ${task.id}: ${r.error.message}`);
      }
    });

    if (mission.status !== 'EXECUTING') {
      const latestTask = mission.tasks.find((t) => t.id === task.id);
      if (!latestTask || latestTask.status !== 'RUNNING') {
        return pausedResult();
      }
    }

    const request = this.buildExecutionRequest(ctx, mission, task, executionId);
    return this.deps.agentExecutor.execute(request);
  }

  async executeTask(ctx: TenantContext, mission: Mission, task: MissionTask): Promise<void> {
    const result = await this.runTask(ctx, mission, task);
    const latest = await this.loadMission(ctx, mission.id);
    const latestTask = latest.tasks.find((t) => t.id === task.id);
    await this.handleTaskResult(ctx, latest, latestTask ?? task, result);
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
    const latest = await this.loadMission(ctx, missionId);
    return { missionId, status: latest.status, completedTaskId: nextTask.id as string };
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

      if (mission.status === 'EXECUTING') {
        const blockResult = mission.block(
          `Task ${task.id} failed: ${result.outcome.summary}`,
          this.deps.generateCorrelationId(),
          this.deps.generateEventId(),
        );
        if (!blockResult.success) {
          throw new Error(`Cannot block mission: ${blockResult.error.message}`);
        }
      }
    }

    await this.saveAndPublish(ctx, mission, async (m) => {
      if (result.status === 'COMPLETED') {
        const completeResult = m.completeTask(
          task.id,
          result.outcome,
          this.deps.generateCorrelationId(),
          this.deps.generateEventId(),
        );
        if (!completeResult.success) {
          throw new Error(`Cannot complete task ${task.id}: ${completeResult.error.message}`);
        }
      } else if (result.status === 'AWAITING_APPROVAL') {
        const markResult = m.markTaskAwaitingApproval(
          task.id,
          `approval:${task.id}`,
          this.deps.generateCorrelationId(),
          this.deps.generateEventId(),
        );
        if (!markResult.success) {
          throw new Error(`Cannot mark task awaiting approval: ${markResult.error.message}`);
        }
        const pauseResult = m.pause(
          `Awaiting approval for task ${task.id}`,
          this.deps.generateCorrelationId(),
          this.deps.generateEventId(),
        );
        if (!pauseResult.success) {
          throw new Error(`Cannot pause mission for approval: ${pauseResult.error.message}`);
        }
      } else if (
        result.status === 'FAILED' ||
        result.status === 'TIMED_OUT' ||
        result.status === 'CANCELLED'
      ) {
        const failResult = m.failTask(
          task.id,
          result.outcome.summary,
          this.deps.generateCorrelationId(),
          this.deps.generateEventId(),
        );
        if (!failResult.success) {
          throw new Error(`Cannot fail task ${task.id}: ${failResult.error.message}`);
        }
        if (m.status === 'EXECUTING') {
          const blockResult = m.block(
            `Task ${task.id} failed: ${result.outcome.summary}`,
            this.deps.generateCorrelationId(),
            this.deps.generateEventId(),
          );
          if (!blockResult.success) {
            throw new Error(`Cannot block mission: ${blockResult.error.message}`);
          }
        }
      }
    });
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
    await this.saveAndPublish(ctx, mission, async (m) => {
      const allCompleted = m.tasks.every((t) => t.status === 'COMPLETED');
      if (allCompleted) {
        const r = m.complete(
          { meetingsBooked: 0, opportunitiesCreated: 0 },
          this.deps.generateCorrelationId(),
          this.deps.generateEventId(),
        );
        if (!r.success) {
          throw new Error(`Cannot complete mission: ${r.error.message}`);
        }
      } else {
        const r = m.fail(
          'No runnable tasks remain and not all tasks completed',
          this.deps.generateCorrelationId(),
          this.deps.generateEventId(),
        );
        if (!r.success) {
          throw new Error(`Cannot fail mission: ${r.error.message}`);
        }
      }
    });
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

  private async loadAvailableAgents(ctx: TenantContext): Promise<AgentContract[]> {
    const agentIds = ['agent-1', 'outreach-orchestrator'];
    const agents: AgentContract[] = [];
    for (const agentId of agentIds) {
      const resolved = await this.deps.agentRegistry.getAgent(ctx, agentId);
      if (resolved) agents.push(resolved.contract);
    }
    return agents;
  }

  private async buildPlan(
    ctx: TenantContext,
    mission: Mission,
  ): Promise<{ plan: PlanContract; availableAgents: AgentContract[] }> {
    const contract = mapMissionToContract(mission);
    const correlationId = this.deps.generateCorrelationId();
    const availableAgents = await this.loadAvailableAgents(ctx);
    const plan = await this.deps.missionPlanner.plan(ctx, {
      mission: contract,
      availableAgents,
      correlationId,
      idempotencyKey: this.deps.generateIdempotencyKey(`plan:${mission.id}`),
    });
    return { plan, availableAgents };
  }

  private async validateCapability(ctx: TenantContext, taskContract: TaskContract): Promise<void> {
    const agent = await this.deps.agentRegistry.getAgent(
      ctx,
      taskContract.agentId,
      taskContract.agentVersion,
    );
    if (!agent) {
      throw new Error(`Missing required agent/capability for task ${taskContract.taskId}`);
    }
    if (taskContract.requiredCapability && !agent.contract.capabilities.includes(taskContract.requiredCapability)) {
      throw new Error(
        `Agent ${agent.agentId} does not support required capability ${taskContract.requiredCapability}`,
      );
    }
  }

  private mapTaskContractToProps(
    mission: Mission,
    taskContract: TaskContract,
    planId: string,
    correlationId: CorrelationId,
  ): MissionTaskProps {
    return {
      id: taskContract.taskId as unknown as TaskId,
      missionId: mission.id,
      planId: taskContract.planId ?? planId,
      agentId: taskContract.agentId,
      agentVersion: taskContract.agentVersion,
      taskType: taskContract.taskType,
      requiredCapability: taskContract.requiredCapability,
      input: taskContract.input,
      dependsOn: taskContract.dependsOn as unknown as TaskId[],
      deadline: taskContract.deadline,
      approvalGateId: taskContract.approvalGateId ?? undefined,
      idempotencyKey: this.deps.generateIdempotencyKey(`task:${taskContract.taskId}:${planId}`),
      correlationId,
      actor: Actor.system('mission-planner', mission.tenantId),
    };
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
      capabilities: task.requiredCapability ? [task.requiredCapability] : ['research'],
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

  private async saveAndPublish(
    ctx: TenantContext,
    mission: Mission,
    reapply: (m: Mission) => Promise<void>,
  ): Promise<Mission> {
    let current = mission;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.deps.missionRepository.save(ctx, current);
        for (const event of current.domainEvents) {
          await this.deps.eventBus.publish(event);
        }
        current.clearDomainEvents();
        return current;
      } catch (err) {
        if (err instanceof ConcurrencyConflictError && attempt < 2) {
          const latest = await this.loadMission(ctx, current.id);
          try {
            await reapply(latest);
          } catch {
            // Authoritative state already satisfies or conflicts with the intended transition.
            return latest;
          }
          current = latest;
          continue;
        }
        throw err;
      }
    }
    return current;
  }

  private flattenTasks(plan: PlanContract): TaskContract[] {
    return plan.phases.flatMap((phase) => phase.tasks);
  }

  private isTerminal(status: string): boolean {
    return ['COMPLETED', 'FAILED', 'CANCELLED', 'ARCHIVED'].includes(status);
  }
}


