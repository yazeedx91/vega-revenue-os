import type { CorrelationId, EventId, IdempotencyKey, TenantId } from '@projectx/shared';
import { DomainEvent } from '../events/domain-event';
import type { MissionId, TaskId } from '../types';
import type { MissionOutcomes, MissionStatus } from './mission-status';

export class MissionCreated extends DomainEvent<{
  missionId: MissionId;
  name: string;
  objective: string;
  icpId: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { missionId: MissionId; name: string; objective: string; icpId: string },
    producer = 'mission-management',
  ) {
    super(eventId, 'MissionCreated', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}

export class MissionApproved extends DomainEvent<{ missionId: MissionId; approvedBy: string }> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { missionId: MissionId; approvedBy: string },
    producer = 'mission-management',
  ) {
    super(eventId, 'MissionApproved', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}

export class MissionReplanned extends DomainEvent<{ missionId: MissionId; planVersion: number }> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { missionId: MissionId; planVersion: number },
    producer = 'mission-management',
  ) {
    super(eventId, 'MissionReplanned', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}

export class MissionStarted extends DomainEvent<{ missionId: MissionId }> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { missionId: MissionId },
    producer = 'mission-management',
  ) {
    super(eventId, 'MissionStarted', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}

export class MissionPaused extends DomainEvent<{ missionId: MissionId; reason: string }> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { missionId: MissionId; reason: string },
    producer = 'mission-management',
  ) {
    super(eventId, 'MissionPaused', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}

export class MissionResumed extends DomainEvent<{ missionId: MissionId }> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { missionId: MissionId },
    producer = 'mission-management',
  ) {
    super(eventId, 'MissionResumed', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}

export class MissionCancelled extends DomainEvent<{ missionId: MissionId; reason: string }> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { missionId: MissionId; reason: string },
    producer = 'mission-management',
  ) {
    super(eventId, 'MissionCancelled', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}

export class MissionCompleted extends DomainEvent<{ missionId: MissionId; outcomes: MissionOutcomes }> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { missionId: MissionId; outcomes: MissionOutcomes },
    producer = 'mission-management',
  ) {
    super(eventId, 'MissionCompleted', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}

export class MissionFailed extends DomainEvent<{ missionId: MissionId; reason: string }> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { missionId: MissionId; reason: string },
    producer = 'mission-management',
  ) {
    super(eventId, 'MissionFailed', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}

export class MissionArchived extends DomainEvent<{ missionId: MissionId }> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { missionId: MissionId },
    producer = 'mission-management',
  ) {
    super(eventId, 'MissionArchived', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}

export class MissionTaskAdded extends DomainEvent<{
  missionId: MissionId;
  taskId: TaskId;
  taskType: string;
  idempotencyKey: IdempotencyKey;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { missionId: MissionId; taskId: TaskId; taskType: string; idempotencyKey: IdempotencyKey },
    producer = 'mission-management',
  ) {
    super(eventId, 'MissionTaskAdded', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}

export class MissionTaskStatusChanged extends DomainEvent<{
  missionId: MissionId;
  taskId: TaskId;
  status: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { missionId: MissionId; taskId: TaskId; status: string },
    producer = 'mission-management',
  ) {
    super(eventId, 'MissionTaskStatusChanged', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}

export class MissionBlocked extends DomainEvent<{ missionId: MissionId; reason: string }> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { missionId: MissionId; reason: string },
    producer = 'mission-management',
  ) {
    super(eventId, 'MissionBlocked', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}

export class MissionUnblocked extends DomainEvent<{ missionId: MissionId }> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { missionId: MissionId },
    producer = 'mission-management',
  ) {
    super(eventId, 'MissionUnblocked', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}

export class MissionTaskTimedOut extends DomainEvent<{ missionId: MissionId; taskId: TaskId }> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { missionId: MissionId; taskId: TaskId },
    producer = 'mission-management',
  ) {
    super(eventId, 'MissionTaskTimedOut', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}

export class MissionTaskCancelled extends DomainEvent<{ missionId: MissionId; taskId: TaskId; reason: string }> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { missionId: MissionId; taskId: TaskId; reason: string },
    producer = 'mission-management',
  ) {
    super(eventId, 'MissionTaskCancelled', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}
