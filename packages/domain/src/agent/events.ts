import type { CorrelationId, EventId, TenantId } from '@projectx/shared';
import { DomainEvent } from '../events/domain-event';
import type { AgentId, CapabilityId } from '../types';

export class AgentCreated extends DomainEvent<{
  agentId: AgentId;
  name: string;
  role: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { agentId: AgentId; name: string; role: string },
    producer = 'agent-management',
  ) {
    super(eventId, 'AgentCreated', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}

export class CapabilityRegistered extends DomainEvent<{
  agentId: AgentId;
  capabilityId: CapabilityId;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { agentId: AgentId; capabilityId: CapabilityId },
    producer = 'agent-management',
  ) {
    super(eventId, 'CapabilityRegistered', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}

export class AgentVersionPublished extends DomainEvent<{
  agentId: AgentId;
  version: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { agentId: AgentId; version: string },
    producer = 'agent-management',
  ) {
    super(eventId, 'AgentVersionPublished', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}

export class AgentActivated extends DomainEvent<{ agentId: AgentId }> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { agentId: AgentId },
    producer = 'agent-management',
  ) {
    super(eventId, 'AgentActivated', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}

export class AgentDeactivated extends DomainEvent<{ agentId: AgentId }> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { agentId: AgentId },
    producer = 'agent-management',
  ) {
    super(eventId, 'AgentDeactivated', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}
