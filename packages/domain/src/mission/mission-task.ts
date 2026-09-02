import type { CorrelationId, IdempotencyKey } from '@projectx/shared';
import { fail, ok, type Result } from '@projectx/shared';
import type { Actor } from '../actor/actor';
import { InvalidStateTransitionError } from '../errors/domain-errors';
import { Entity } from '../entity/entity';
import type { MissionId, TaskId } from '../types';
import { canTransitionTask, type TaskStatus } from './mission-status';

export interface MissionTaskProps {
  readonly id: TaskId;
  readonly missionId: MissionId;
  readonly planId: string;
  readonly agentId: string;
  readonly agentVersion: string;
  readonly taskType: string;
  readonly input: unknown;
  readonly dependsOn: TaskId[];
  readonly deadline?: Date;
  readonly approvalGateId?: string;
  readonly idempotencyKey: IdempotencyKey;
  readonly correlationId: CorrelationId;
  readonly actor: Actor;
}

export class MissionTask extends Entity<TaskId> {
  public readonly missionId: MissionId;
  public readonly planId: string;
  public readonly agentId: string;
  public readonly agentVersion: string;
  public readonly taskType: string;
  public readonly input: unknown;
  public readonly dependsOn: TaskId[];
  public readonly deadline?: Date;
  public approvalGateId?: string;
  public readonly idempotencyKey: IdempotencyKey;
  public readonly correlationId: CorrelationId;
  public readonly actor: Actor;
  public status: TaskStatus = 'PENDING';
  public output?: unknown;
  public startedAt?: Date;
  public completedAt?: Date;

  constructor(props: MissionTaskProps) {
    super(props.id);
    this.missionId = props.missionId;
    this.planId = props.planId;
    this.agentId = props.agentId;
    this.agentVersion = props.agentVersion;
    this.taskType = props.taskType;
    this.input = props.input;
    this.dependsOn = props.dependsOn;
    this.deadline = props.deadline;
    this.approvalGateId = props.approvalGateId;
    this.idempotencyKey = props.idempotencyKey;
    this.correlationId = props.correlationId;
    this.actor = props.actor;
  }

  transitionStatus(to: TaskStatus): Result<void, InvalidStateTransitionError> {
    if (!canTransitionTask(this.status, to)) {
      return fail(new InvalidStateTransitionError(`Cannot transition task from ${this.status} to ${to}`));
    }
    this.status = to;
    if (to === 'RUNNING') {
      this.startedAt = new Date();
    }
    if (to === 'COMPLETED' || to === 'FAILED' || to === 'CANCELLED' || to === 'TIMED_OUT') {
      this.completedAt = new Date();
    }
    return ok(undefined);
  }
}
