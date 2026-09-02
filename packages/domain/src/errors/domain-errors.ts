import { AuthorizationError, DomainError, TenantIsolationError, ValidationError } from '@projectx/shared';

export class InvalidStateTransitionError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_STATE_TRANSITION');
  }
}

export class MissionInvariantError extends DomainError {
  constructor(message: string) {
    super(message, 'MISSION_INVARIANT_VIOLATION');
  }
}

export class AgentInvariantError extends DomainError {
  constructor(message: string) {
    super(message, 'AGENT_INVARIANT_VIOLATION');
  }
}

export class CapabilityError extends DomainError {
  constructor(message: string) {
    super(message, 'CAPABILITY_VIOLATION');
  }
}

export class IdempotencyError extends DomainError {
  constructor(message = 'Duplicate idempotency key') {
    super(message, 'IDEMPOTENCY_DUPLICATE');
  }
}

export { AuthorizationError, DomainError, TenantIsolationError, ValidationError };
