import type { CorrelationId, EventId, IdempotencyKey, TenantId, UserId } from '@projectx/shared';
import { fail, ok, type Result } from '@projectx/shared';
import { AggregateRoot } from '@projectx/domain';
import type { ApprovalId } from '@projectx/domain';
import { ApprovalRequested, ApprovalStatusChanged } from './approval-events';
import { canTransitionApproval, type ApprovalStatus } from './approval-status';

export interface ApprovalProps {
  readonly id: ApprovalId;
  readonly tenantId: TenantId;
  readonly missionId: string;
  readonly sequenceId?: string;
  readonly taskId?: string;
  readonly executionId?: string;
  readonly actionType: string;
  readonly riskCategory: string;
  readonly proposedAction: unknown;
  readonly evidence: unknown[];
  readonly reasoning: string;
  readonly confidence: number;
  readonly requestedBy: string;
  readonly approverRole: string;
  readonly timeoutSeconds: number;
  readonly idempotencyKey: IdempotencyKey;
  readonly correlationId: CorrelationId;
  readonly status?: ApprovalStatus;
  readonly decidedBy?: UserId;
  readonly decisionReason?: string;
  readonly createdAt?: Date;
  readonly updatedAt?: Date;
}

export class Approval extends AggregateRoot<ApprovalId> {
  public readonly missionId: string;
  public readonly sequenceId?: string;
  public readonly taskId?: string;
  public readonly executionId?: string;
  public readonly actionType: string;
  public readonly riskCategory: string;
  public readonly proposedAction: unknown;
  public readonly evidence: unknown[];
  public readonly reasoning: string;
  public readonly confidence: number;
  public readonly requestedBy: string;
  public readonly approverRole: string;
  public readonly timeoutSeconds: number;
  public readonly idempotencyKey: IdempotencyKey;
  public readonly correlationId: CorrelationId;
  public readonly createdAt: Date;
  public updatedAt: Date;
  private _status: ApprovalStatus = 'PENDING';
  private _decidedBy?: UserId;
  private _decisionReason?: string;

  get status(): ApprovalStatus {
    return this._status;
  }

  get decidedBy(): UserId | undefined {
    return this._decidedBy;
  }

  get decisionReason(): string | undefined {
    return this._decisionReason;
  }

  private constructor(props: ApprovalProps) {
    super(props.tenantId, props.id);
    this.missionId = props.missionId;
    this.sequenceId = props.sequenceId;
    this.taskId = props.taskId;
    this.executionId = props.executionId;
    this.actionType = props.actionType;
    this.riskCategory = props.riskCategory;
    this.proposedAction = props.proposedAction;
    this.evidence = props.evidence;
    this.reasoning = props.reasoning;
    this.confidence = props.confidence;
    this.requestedBy = props.requestedBy;
    this.approverRole = props.approverRole;
    this.timeoutSeconds = props.timeoutSeconds;
    this.idempotencyKey = props.idempotencyKey;
    this.correlationId = props.correlationId;
    this._status = props.status ?? 'PENDING';
    this._decidedBy = props.decidedBy;
    this._decisionReason = props.decisionReason;
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? new Date();
  }

  static create(
    props: ApprovalProps,
    eventId: EventId,
  ): Result<Approval, Error> {
    const approval = new Approval(props);
    approval.applyEvent(
      new ApprovalRequested(
        eventId,
        props.tenantId,
        props.correlationId,
        {
          approvalId: props.id,
          missionId: props.missionId,
          sequenceId: props.sequenceId,
          taskId: props.taskId,
          executionId: props.executionId,
          actionType: props.actionType,
          riskCategory: props.riskCategory,
          proposedAction: props.proposedAction,
          evidence: props.evidence,
          reasoning: props.reasoning,
          confidence: props.confidence,
          requestedBy: props.requestedBy,
          approverRole: props.approverRole,
          timeoutSeconds: props.timeoutSeconds,
        },
      ),
    );
    return ok(approval);
  }

  static reconstitute(snapshot: ApprovalProps, version: number): Approval {
    const approval = new Approval(snapshot);
    approval.setVersion(version);
    approval.clearDomainEvents();
    return approval;
  }

  approve(
    decidedBy: UserId,
    reason: string,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, Error> {
    return this.decide('APPROVED', decidedBy, reason, correlationId, eventId);
  }

  reject(
    decidedBy: UserId,
    reason: string,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, Error> {
    return this.decide('REJECTED', decidedBy, reason, correlationId, eventId);
  }

  expire(
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, Error> {
    return this.transition(
      'EXPIRED',
      undefined,
      'Approval timeout exceeded',
      correlationId,
      eventId,
    );
  }

  escalate(
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, Error> {
    return this.transition(
      'ESCALATED',
      undefined,
      'Approval escalated',
      correlationId,
      eventId,
    );
  }

  private decide(
    status: ApprovalStatus,
    decidedBy: UserId,
    reason: string,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, Error> {
    return this.transition(status, decidedBy, reason, correlationId, eventId);
  }

  private transition(
    status: ApprovalStatus,
    decidedBy: UserId | undefined,
    reason: string,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, Error> {
    if (!canTransitionApproval(this._status, status)) {
      return fail(new Error(`Cannot transition approval from ${this._status} to ${status}`));
    }
    this._status = status;
    this._decidedBy = decidedBy;
    this._decisionReason = reason;
    this.updatedAt = new Date();
    this.applyEvent(
      new ApprovalStatusChanged(
        eventId,
        this.tenantId,
        correlationId,
        {
          approvalId: this.id,
          missionId: this.missionId,
          status,
          decidedBy,
          decisionReason: reason,
        },
      ),
    );
    return ok(undefined);
  }
}
