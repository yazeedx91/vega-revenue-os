import type { TenantId, ResearchRequestId, ResearchRunId } from '@projectx/shared';

export const MAX_QUERY_HASH_LENGTH = 256;
export const MAX_FAILURE_MESSAGE_LENGTH = 1024;
export const MAX_FAILURE_CODE_LENGTH = 128;

const OPAQUE_HASH_PATTERN = /^[A-Za-z0-9_-]+$/;

function validateOpaqueHash(value: string, fieldName: string, maxLength: number): void {
  if (!value || value.length === 0) {
    throw new ResearchDomainError(`${fieldName} must be non-empty`);
  }
  if (value.length > maxLength) {
    throw new ResearchDomainError(`${fieldName} must not exceed ${maxLength} characters`);
  }
  if (!OPAQUE_HASH_PATTERN.test(value)) {
    throw new ResearchDomainError(`${fieldName} must be opaque machine-safe format (base64url-safe characters only)`);
  }
}

function validateIsoTimestamp(value: string, fieldName: string): void {
  if (!value || value.length === 0) {
    throw new ResearchDomainError(`${fieldName} must be non-empty`);
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    throw new ResearchDomainError(`${fieldName} must be a valid ISO-8601 timestamp`);
  }
}

export class ResearchDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResearchDomainError';
  }
}

export type ResearchRunStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

export interface ResearchRequestProps {
  readonly id: ResearchRequestId;
  readonly tenantId: TenantId;
  readonly workspaceId: string;
  readonly missionId?: string;
  readonly queryHash: string;
  readonly requestedAt: string;
}

export class ResearchRequest {
  public readonly id: ResearchRequestId;
  public readonly tenantId: TenantId;
  public readonly workspaceId: string;
  public readonly missionId?: string;
  public readonly queryHash: string;
  public readonly requestedAt: string;

  private constructor(props: ResearchRequestProps) {
    this.id = props.id;
    this.tenantId = props.tenantId;
    this.workspaceId = props.workspaceId;
    this.missionId = props.missionId;
    this.queryHash = props.queryHash;
    this.requestedAt = props.requestedAt;
  }

  static create(props: ResearchRequestProps): ResearchRequest {
    if (!props.workspaceId) {
      throw new ResearchDomainError('workspaceId must be non-empty');
    }
    validateOpaqueHash(props.queryHash, 'queryHash', MAX_QUERY_HASH_LENGTH);
    validateIsoTimestamp(props.requestedAt, 'requestedAt');
    const request = new ResearchRequest(props);
    Object.freeze(request);
    return request;
  }
}

export interface ResearchRunProps {
  readonly id: ResearchRunId;
  readonly tenantId: TenantId;
  readonly workspaceId: string;
  readonly requestId: ResearchRequestId;
  readonly status?: ResearchRunStatus;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly failureCode?: string;
  readonly failureMessage?: string;
}

export class ResearchRun {
  public readonly id: ResearchRunId;
  public readonly tenantId: TenantId;
  public readonly workspaceId: string;
  public readonly requestId: ResearchRequestId;

  private _status: ResearchRunStatus;
  private _startedAt?: string;
  private _completedAt?: string;
  private _failureCode?: string;
  private _failureMessage?: string;

  private constructor(props: ResearchRunProps) {
    this.id = props.id;
    this.tenantId = props.tenantId;
    this.workspaceId = props.workspaceId;
    this.requestId = props.requestId;
    this._status = props.status ?? 'PENDING';
    this._startedAt = props.startedAt;
    this._completedAt = props.completedAt;
    this._failureCode = props.failureCode;
    this._failureMessage = props.failureMessage;
  }

  get status(): ResearchRunStatus { return this._status; }
  get startedAt(): string | undefined { return this._startedAt; }
  get completedAt(): string | undefined { return this._completedAt; }
  get failureCode(): string | undefined { return this._failureCode; }
  get failureMessage(): string | undefined { return this._failureMessage; }

  static create(props: ResearchRunProps): ResearchRun {
    if (!props.workspaceId) {
      throw new ResearchDomainError('workspaceId must be non-empty');
    }
    return new ResearchRun({ ...props, status: 'PENDING' });
  }

  static reconstitute(props: ResearchRunProps): ResearchRun {
    return new ResearchRun(props);
  }

  start(at: string): void {
    if (this._status !== 'PENDING') {
      throw new ResearchDomainError(`Cannot start ResearchRun in status ${this._status}; must be PENDING`);
    }
    validateIsoTimestamp(at, 'startedAt');
    this._status = 'RUNNING';
    this._startedAt = at;
  }

  succeed(at: string): void {
    if (this._status !== 'RUNNING') {
      throw new ResearchDomainError(`Cannot succeed ResearchRun in status ${this._status}; must be RUNNING`);
    }
    validateIsoTimestamp(at, 'completedAt');
    if (this._startedAt && at < this._startedAt) {
      throw new ResearchDomainError('completedAt must not precede startedAt');
    }
    this._status = 'SUCCEEDED';
    this._completedAt = at;
  }

  fail(code: string, message: string, at: string): void {
    if (this._status !== 'RUNNING') {
      throw new ResearchDomainError(`Cannot fail ResearchRun in status ${this._status}; must be RUNNING`);
    }
    if (!code || code.length === 0) {
      throw new ResearchDomainError('failureCode must be non-empty');
    }
    if (code.length > MAX_FAILURE_CODE_LENGTH) {
      throw new ResearchDomainError(`failureCode must not exceed ${MAX_FAILURE_CODE_LENGTH} characters`);
    }
    if (message.length > MAX_FAILURE_MESSAGE_LENGTH) {
      throw new ResearchDomainError(`failureMessage must not exceed ${MAX_FAILURE_MESSAGE_LENGTH} characters`);
    }
    validateIsoTimestamp(at, 'completedAt');
    if (this._startedAt && at < this._startedAt) {
      throw new ResearchDomainError('completedAt must not precede startedAt');
    }
    this._status = 'FAILED';
    this._completedAt = at;
    this._failureCode = code;
    this._failureMessage = message;
  }
}
