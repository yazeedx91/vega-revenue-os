export abstract class DomainError extends Error {
  protected constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class TenantIsolationError extends DomainError {
  constructor(message = 'Cross-tenant access detected') {
    super(message, 'TENANT_ISOLATION_VIOLATION');
  }
}

export class AuthorizationError extends DomainError {
  constructor(message = 'Action not authorized') {
    super(message, 'AUTHORIZATION_DENIED');
  }
}

export class ValidationError extends DomainError {
  constructor(message = 'Validation failed') {
    super(message, 'VALIDATION_ERROR');
  }
}
