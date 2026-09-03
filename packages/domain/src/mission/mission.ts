import type { CorrelationId, EventId, IdempotencyKey } from '@projectx/shared';
import { fail, ok, type Result } from '@projectx/shared';
import type { Actor } from '../actor/actor';
import { AggregateRoot } from '../aggregate/aggregate-root';
import { InvalidStateTransitionError, MissionInvariantError } from '../errors/domain-errors';
import type { MissionId, TaskId, UserId } from '../types';
import * as MissionEvents from './events';
import { MissionTask, type MissionTaskProps } from './mission-task';
import {
  canTransitionMission,
  type MissionOutcomes,
  type MissionStatus,
} from './mission-status';

export interface MissionBudget {
  readonly maxAiCostUsd: number;
  readonly maxOutreachCount?: number;
}

export interface MissionConstraints {
  readonly workingHours?: string;
  readonly noContactDomains?: string[];
  readonly minimumCompanySize?: number;
}

export interface MissionSuccessCriteria {
  readonly targetMeetings?: number;
  readonly targetOpportunities?: number;
}

export interface MissionPlan {
  readonly planId: string;
  readonly version: number;
  readonly objectives: unknown[];
  readonly phases: unknown[];
  readonly approvalGates: unknown[];
  readonly fallbackBranches: unknown[];
}

export interface MissionProps {
  readonly id: MissionId;
  readonly tenantId: string & { readonly __brand: 'TenantId' };
  readonly name: string;
  readonly objective: string;
  readonly icpId: string;
  readonly territory: string[];
  readonly channels: string[];
  readonly budget: MissionBudget;
  readonly autonomyLevel: number;
  readonly constraints: MissionConstraints;
  readonly successCriteria: MissionSuccessCriteria;
  readonly deadline?: Date;
  readonly ownerUserId: UserId;
  readonly plan: MissionPlan;
  readonly status?: MissionStatus;
  readonly tasks?: MissionTask[];
  readonly approvals?: unknown[];
  readonly outcomes?: MissionOutcomes;
  readonly createdAt?: Date;
  readonly updatedAt?: Date;
}

export class Mission extends AggregateRoot<MissionId> {
  public readonly name: string;
  public readonly objective: string;
  public readonly icpId: string;
  public readonly territory: string[];
  public readonly channels: string[];
  public readonly budget: MissionBudget;
  public readonly autonomyLevel: number;
  public readonly constraints: MissionConstraints;
  public readonly successCriteria: MissionSuccessCriteria;
  public readonly deadline?: Date;
  public readonly ownerUserId: UserId;
  public plan: MissionPlan;
  public readonly createdAt: Date;
  public updatedAt: Date;
  private _status: MissionStatus = 'DRAFT';
  private _tasks: MissionTask[] = [];
  private readonly _approvals: unknown[] = [];
  private _outcomes: MissionOutcomes = {};

  get status(): MissionStatus {
    return this._status;
  }

  get tasks(): readonly MissionTask[] {
    return this._tasks;
  }

  get approvals(): readonly unknown[] {
    return this._approvals;
  }

  get outcomes(): MissionOutcomes {
    return this._outcomes;
  }

  private constructor(props: MissionProps) {
    super(props.tenantId, props.id);
    this.name = props.name;
    this.objective = props.objective;
    this.icpId = props.icpId;
    this.territory = props.territory;
    this.channels = props.channels;
    this.budget = props.budget;
    this.autonomyLevel = props.autonomyLevel;
    this.constraints = props.constraints;
    this.successCriteria = props.successCriteria;
    this.deadline = props.deadline;
    this.ownerUserId = props.ownerUserId;
    this.plan = props.plan;
    this._status = props.status ?? 'DRAFT';
    this._tasks.push(...(props.tasks ?? []));
    this._approvals.push(...(props.approvals ?? []));
    this._outcomes = props.outcomes ?? {};
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? new Date();
  }

  static create(
    props: MissionProps,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<Mission, MissionInvariantError> {
    if (!props.objective || props.objective.trim().length === 0) {
      return fail(new MissionInvariantError('Mission objective is required'));
    }
    if (!props.icpId || props.icpId.trim().length === 0) {
      return fail(new MissionInvariantError('ICP reference is required'));
    }
    if (props.deadline && props.deadline.getTime() <= Date.now()) {
      return fail(new MissionInvariantError('Deadline must be in the future'));
    }

    const mission = new Mission(props);
    mission.applyEvent(
      new MissionEvents.MissionCreated(eventId, props.tenantId, correlationId, {
        missionId: props.id,
        name: props.name,
        objective: props.objective,
        icpId: props.icpId,
      }),
    );
    return ok(mission);
  }

  static reconstitute(snapshot: MissionProps, version: number): Mission {
    const mission = new Mission(snapshot);
    mission.setVersion(version);
    mission.clearDomainEvents();
    return mission;
  }

  approve(actor: Actor, correlationId: CorrelationId, eventId: EventId): Result<void, InvalidStateTransitionError> {
    return this.transitionTo('APPROVED', correlationId, () =>
      new MissionEvents.MissionApproved(eventId, this.tenantId, correlationId, {
        missionId: this.id,
        approvedBy: actor.id,
      }),
    );
  }

  schedule(correlationId: CorrelationId, eventId: EventId): Result<void, InvalidStateTransitionError> {
    return this.transitionTo('SCHEDULED', correlationId, () =>
      new MissionEvents.MissionStarted(eventId, this.tenantId, correlationId, {
        missionId: this.id,
      }),
    );
  }

  start(correlationId: CorrelationId, eventId: EventId): Result<void, InvalidStateTransitionError> {
    return this.transitionTo('PLANNING', correlationId, () =>
      new MissionEvents.MissionStarted(eventId, this.tenantId, correlationId, {
        missionId: this.id,
      }),
    );
  }

  planValid(
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, InvalidStateTransitionError | MissionInvariantError> {
    const validation = this.validateTaskGraph(this._tasks, this.plan.version);
    if (validation) {
      return fail(validation);
    }
    return this.transitionTo('EXECUTING', correlationId, () =>
      new MissionEvents.MissionStarted(eventId, this.tenantId, correlationId, {
        missionId: this.id,
      }),
    );
  }

  replan(
    newPlan: MissionPlan,
    newTasks: MissionTaskProps[],
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, MissionInvariantError | InvalidStateTransitionError> {
    if (this.isTerminal()) {
      return fail(new MissionInvariantError('Cannot replan a terminal mission'));
    }
    if (newPlan.version <= 0) {
      return fail(new MissionInvariantError('Plan version must be positive'));
    }
    if (newPlan.version <= this.plan.version) {
      return fail(
        new MissionInvariantError(
          `Plan version ${newPlan.version} is not greater than current version ${this.plan.version}`,
        ),
      );
    }

    const existingCompleted = new Map<string, MissionTask>(
      this._tasks
        .filter((t) => t.status === 'COMPLETED')
        .map((t) => [t.id as string, t]),
    );

    const tasks: MissionTask[] = newTasks.map((props) => {
      const existing = existingCompleted.get(props.id as string);
      const task = new MissionTask(props);
      if (existing && existing.status === 'COMPLETED') {
        task.status = existing.status;
        task.output = existing.output;
        task.startedAt = existing.startedAt;
        task.completedAt = existing.completedAt;
      }
      return task;
    });

    const validation = this.validateTaskGraph(tasks, newPlan.version);
    if (validation) {
      return fail(validation);
    }

    this.plan = newPlan;
    this._tasks = tasks;
    this.updatedAt = new Date();
    this.applyEvent(
      new MissionEvents.MissionReplanned(eventId, this.tenantId, correlationId, {
        missionId: this.id,
        planVersion: newPlan.version,
      }),
    );
    return ok(undefined);
  }

  pause(
    reason: string,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, InvalidStateTransitionError> {
    return this.transitionTo('PAUSED', correlationId, () =>
      new MissionEvents.MissionPaused(eventId, this.tenantId, correlationId, {
        missionId: this.id,
        reason,
      }),
    );
  }

  resume(correlationId: CorrelationId, eventId: EventId): Result<void, InvalidStateTransitionError> {
    return this.transitionTo('EXECUTING', correlationId, () =>
      new MissionEvents.MissionResumed(eventId, this.tenantId, correlationId, {
        missionId: this.id,
      }),
    );
  }

  cancel(
    reason: string,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, InvalidStateTransitionError> {
    return this.transitionTo('CANCELLED', correlationId, () =>
      new MissionEvents.MissionCancelled(eventId, this.tenantId, correlationId, {
        missionId: this.id,
        reason,
      }),
    );
  }

  complete(
    outcomes: MissionOutcomes,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, InvalidStateTransitionError> {
    return this.transitionTo('COMPLETED', correlationId, () => {
      this._outcomes = outcomes;
      return new MissionEvents.MissionCompleted(eventId, this.tenantId, correlationId, {
        missionId: this.id,
        outcomes,
      });
    });
  }

  fail(
    reason: string,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, InvalidStateTransitionError> {
    return this.transitionTo('FAILED', correlationId, () =>
      new MissionEvents.MissionFailed(eventId, this.tenantId, correlationId, {
        missionId: this.id,
        reason,
      }),
    );
  }

  archive(correlationId: CorrelationId, eventId: EventId): Result<void, InvalidStateTransitionError> {
    return this.transitionTo('ARCHIVED', correlationId, () =>
      new MissionEvents.MissionArchived(eventId, this.tenantId, correlationId, {
        missionId: this.id,
      }),
    );
  }

  block(
    reason: string,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, InvalidStateTransitionError> {
    return this.transitionTo('BLOCKED', correlationId, () =>
      new MissionEvents.MissionBlocked(eventId, this.tenantId, correlationId, {
        missionId: this.id,
        reason,
      }),
    );
  }

  unblock(correlationId: CorrelationId, eventId: EventId): Result<void, InvalidStateTransitionError> {
    return this.transitionTo('EXECUTING', correlationId, () =>
      new MissionEvents.MissionUnblocked(eventId, this.tenantId, correlationId, {
        missionId: this.id,
      }),
    );
  }

  addTask(
    props: MissionTaskProps,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<MissionTask, MissionInvariantError> {
    if (this.isTerminal()) {
      return fail(new MissionInvariantError('Cannot add tasks to a terminal mission'));
    }
    if (this._tasks.some((t) => t.id === props.id)) {
      return fail(new MissionInvariantError('Duplicate task ID in plan'));
    }
    if (this._tasks.some((t) => t.idempotencyKey === props.idempotencyKey)) {
      return fail(new MissionInvariantError('Duplicate task idempotency key'));
    }
    if (props.requiredCapability !== undefined && props.requiredCapability.trim() === '') {
      return fail(new MissionInvariantError('Task missing required capability'));
    }

    const task = new MissionTask(props);
    this._tasks.push(task);
    this.applyEvent(
      new MissionEvents.MissionTaskAdded(eventId, this.tenantId, correlationId, {
        missionId: this.id,
        taskId: props.id,
        taskType: props.taskType,
        idempotencyKey: props.idempotencyKey,
      }),
    );
    return ok(task);
  }

  startTask(
    taskId: TaskId,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, MissionInvariantError | InvalidStateTransitionError> {
    const task = this.findTask(taskId);
    if (!task) {
      return fail(new MissionInvariantError('Task not found'));
    }
    if (this.status !== 'EXECUTING') {
      return fail(new MissionInvariantError('Mission must be executing to start a task'));
    }
    const incompleteDependencies = task.dependsOn.some(
      (depId) => !this._tasks.some((t) => t.id === depId && t.status === 'COMPLETED'),
    );
    if (incompleteDependencies) {
      return fail(new MissionInvariantError('Task dependencies are not completed'));
    }
    const transition = task.transitionStatus('RUNNING');
    if (!transition.success) {
      return transition;
    }
    this.applyEvent(
      new MissionEvents.MissionTaskStatusChanged(eventId, this.tenantId, correlationId, {
        missionId: this.id,
        taskId,
        status: 'RUNNING',
      }),
    );
    return ok(undefined);
  }

  completeTask(
    taskId: TaskId,
    output: unknown,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, MissionInvariantError | InvalidStateTransitionError> {
    const task = this.findTask(taskId);
    if (!task) {
      return fail(new MissionInvariantError('Task not found'));
    }
    const transition = task.transitionStatus('COMPLETED');
    if (!transition.success) {
      return transition;
    }
    task.output = output;
    this.applyEvent(
      new MissionEvents.MissionTaskStatusChanged(eventId, this.tenantId, correlationId, {
        missionId: this.id,
        taskId,
        status: 'COMPLETED',
      }),
    );
    return ok(undefined);
  }

  failTask(
    taskId: TaskId,
    reason: string,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, MissionInvariantError | InvalidStateTransitionError> {
    const task = this.findTask(taskId);
    if (!task) {
      return fail(new MissionInvariantError('Task not found'));
    }
    const transition = task.transitionStatus('FAILED');
    if (!transition.success) {
      return transition;
    }
    task.output = { reason };
    this.applyEvent(
      new MissionEvents.MissionTaskStatusChanged(eventId, this.tenantId, correlationId, {
        missionId: this.id,
        taskId,
        status: 'FAILED',
      }),
    );
    return ok(undefined);
  }

  timeoutTask(
    taskId: TaskId,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, MissionInvariantError | InvalidStateTransitionError> {
    const task = this.findTask(taskId);
    if (!task) {
      return fail(new MissionInvariantError('Task not found'));
    }
    const transition = task.transitionStatus('TIMED_OUT');
    if (!transition.success) {
      return transition;
    }
    this.applyEvent(
      new MissionEvents.MissionTaskStatusChanged(eventId, this.tenantId, correlationId, {
        missionId: this.id,
        taskId,
        status: 'TIMED_OUT',
      }),
    );
    this.applyEvent(
      new MissionEvents.MissionTaskTimedOut(eventId, this.tenantId, correlationId, {
        missionId: this.id,
        taskId,
      }),
    );
    return ok(undefined);
  }

  cancelTask(
    taskId: TaskId,
    reason: string,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, MissionInvariantError | InvalidStateTransitionError> {
    const task = this.findTask(taskId);
    if (!task) {
      return fail(new MissionInvariantError('Task not found'));
    }
    const transition = task.transitionStatus('CANCELLED');
    if (!transition.success) {
      return transition;
    }
    this.applyEvent(
      new MissionEvents.MissionTaskStatusChanged(eventId, this.tenantId, correlationId, {
        missionId: this.id,
        taskId,
        status: 'CANCELLED',
      }),
    );
    this.applyEvent(
      new MissionEvents.MissionTaskCancelled(eventId, this.tenantId, correlationId, {
        missionId: this.id,
        taskId,
        reason,
      }),
    );
    return ok(undefined);
  }

  markTaskAwaitingApproval(
    taskId: TaskId,
    approvalGateId: string,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, MissionInvariantError | InvalidStateTransitionError> {
    const task = this.findTask(taskId);
    if (!task) {
      return fail(new MissionInvariantError('Task not found'));
    }
    const transition = task.transitionStatus('AWAITING_APPROVAL');
    if (!transition.success) {
      return transition;
    }
    task.approvalGateId = approvalGateId;
    this.applyEvent(
      new MissionEvents.MissionTaskStatusChanged(eventId, this.tenantId, correlationId, {
        missionId: this.id,
        taskId,
        status: 'AWAITING_APPROVAL',
      }),
    );
    return ok(undefined);
  }

  private findTask(taskId: TaskId): MissionTask | undefined {
    return this._tasks.find((t) => t.id === taskId);
  }

  private validateTaskGraph(
    tasks: MissionTask[],
    planVersion: number,
  ): MissionInvariantError | undefined {
    if (planVersion <= 0) {
      return new MissionInvariantError('Plan version must be positive');
    }

    const taskIds = new Set<string>();
    const ids = tasks.map((t) => t.id as string);
    for (const id of ids) {
      if (taskIds.has(id)) {
        return new MissionInvariantError('Duplicate task IDs in plan');
      }
      taskIds.add(id);
    }

    for (const task of tasks) {
      if (!task.agentId || task.agentId.trim().length === 0) {
        return new MissionInvariantError(`Task ${task.id} missing required agent/capability`);
      }
      if (task.requiredCapability !== undefined && task.requiredCapability.trim().length === 0) {
        return new MissionInvariantError(`Task ${task.id} missing required capability`);
      }
      for (const dep of task.dependsOn) {
        const depId = dep as string;
        if (!taskIds.has(depId)) {
          return new MissionInvariantError(`Missing dependency ${depId} in plan`);
        }
      }
    }

    const taskById = new Map<string, MissionTask>(tasks.map((t) => [t.id as string, t]));
    const visited = new Set<string>();
    const stack = new Set<string>();

    const visit = (id: string): MissionInvariantError | undefined => {
      if (stack.has(id)) {
        return new MissionInvariantError('Cyclic dependency detected in plan');
      }
      if (visited.has(id)) {
        return undefined;
      }
      stack.add(id);
      const task = taskById.get(id);
      if (task) {
        for (const dep of task.dependsOn) {
          const err = visit(dep as string);
          if (err) return err;
        }
      }
      stack.delete(id);
      visited.add(id);
      return undefined;
    };

    for (const id of taskIds) {
      const err = visit(id);
      if (err) return err;
    }

    return undefined;
  }

  private transitionTo(
    target: MissionStatus,
    correlationId: CorrelationId,
    eventFactory: () => import('../events/domain-event').DomainEvent<unknown>,
  ): Result<void, InvalidStateTransitionError> {
    if (!canTransitionMission(this._status, target)) {
      return fail(new InvalidStateTransitionError(`Cannot transition mission from ${this._status} to ${target}`));
    }
    this._status = target;
    this.updatedAt = new Date();
    this.applyEvent(eventFactory());
    return ok(undefined);
  }

  private isTerminal(): boolean {
    return ['COMPLETED', 'FAILED', 'CANCELLED', 'ARCHIVED'].includes(this._status);
  }
}
