import type { CorrelationId, IdempotencyKey } from '../types/correlation';
import type { TenantId } from '../types/tenant-id';

export interface ToolCallRequest<TInput = unknown> {
  toolCallId: string;
  toolId: string;
  toolVersion: string;
  tenantId: TenantId;
  missionId?: string;
  agentId?: string;
  agentVersion?: string;
  executionId?: string;
  taskId?: string;
  correlationId: CorrelationId;
  idempotencyKey?: IdempotencyKey;
  authorization: ToolAuthorization;
  riskCategory: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  input: TInput;
  timeoutSeconds: number;
  metadata?: Record<string, unknown>;
}

export interface ToolAuthorization {
  policyDecisionId: string;
  decision: 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';
  capabilities: string[];
  expiresAt: Date;
}

/**
 * Tool/provider outcome status. `OUTCOME_UNKNOWN` means the provider request was
 * submitted but the outcome is not definitively known (e.g. response lost after
 * possible acceptance). It is NOT a safely-failed state and must map to the
 * execution-level `REQUIRES_RECONCILIATION` operational state — never to a
 * generic `FAILED`.
 */
export type ToolCallStatus =
  | 'SUCCESS'
  | 'VALIDATION_ERROR'
  | 'PROVIDER_ERROR'
  | 'TIMEOUT'
  | 'UNAUTHORIZED'
  | 'POLICY_DENIED'
  | 'OUTCOME_UNKNOWN'
  | 'FAILED';

export interface ToolCallResult<TOutput = unknown> {
  toolCallId: string;
  status: ToolCallStatus;
  output?: TOutput;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  validation: ToolValidation;
  provider: string;
  startedAt: Date;
  completedAt: Date;
  retryCount: number;
  auditId: string;
}

export interface ToolValidation {
  schemaValid: boolean;
  tenantIsolationCheck: boolean;
  piiCheck: 'PASSED' | 'FAILED' | 'NOT_RUN';
}

/**
 * Side-effect classification drives retry/idempotency semantics.
 * - READ_ONLY: no external side effect; bounded retry permitted.
 * - REVERSIBLE_WRITE: side effect can be undone; durable idempotency required,
 *   retry only when proven safe.
 * - IRREVERSIBLE_EXTERNAL: external side effect cannot be undone; durable
 *   idempotency required, no automatic retry after ambiguous submission.
 */
export type ToolSideEffectClass =
  | 'READ_ONLY'
  | 'REVERSIBLE_WRITE'
  | 'IRREVERSIBLE_EXTERNAL';

/**
 * Canonical forward-only tool lifecycle: DRAFT → ACTIVE → DEPRECATED → RETIRED.
 * Contract fields lock on the DRAFT → ACTIVE transition.
 */
export type ToolLifecycle = 'DRAFT' | 'ACTIVE' | 'DEPRECATED' | 'RETIRED';

/**
 * Strict JSON-schema shape used for tool input/output validation. Shared at the
 * lowest level so the tool gateway does not depend on the LLM output validator.
 */
export interface ToolSchemaDefinition {
  readonly type: 'object' | 'array' | 'string' | 'number' | 'boolean';
  readonly required?: readonly string[];
  readonly properties?: Record<string, ToolSchemaDefinition>;
  readonly items?: ToolSchemaDefinition;
  readonly allowedValues?: readonly unknown[];
}

export interface ToolSchemaValidationResult {
  readonly valid: boolean;
  readonly violations: string[];
}

/**
 * Strict schema-validation port for tool input/output. Implemented by a shared
 * validator so tool-gateway has no dependency on the LLM-specific validator.
 */
export interface IToolSchemaValidator {
  validate(value: unknown, schema: ToolSchemaDefinition): ToolSchemaValidationResult;
}

/**
 * Immutable, versioned tool contract registered in the tool registry.
 * `tenantId === null` denotes a global definition readable by all tenants but
 * not tenant-mutable. Contract fields are immutable once lifecycle is ACTIVE.
 */
export interface ToolDefinition {
  readonly toolDefinitionId: string;
  readonly toolId: string;
  readonly version: string;
  readonly tenantId: string | null;
  readonly description: string;
  readonly inputSchema?: ToolSchemaDefinition;
  readonly outputSchema?: ToolSchemaDefinition;
  readonly requiredCapabilities: readonly string[];
  readonly riskCategory: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly sideEffectClass: ToolSideEffectClass;
  readonly requiredApproval: boolean;
  readonly providerId: string;
  readonly enabled: boolean;
  readonly timeoutSeconds: number;
  readonly maxRetries: number;
  readonly idempotencyRequired: boolean;
  readonly costMetadata?: Record<string, unknown>;
  readonly config?: Record<string, unknown>;
  readonly lifecycle: ToolLifecycle;
  readonly createdAt?: Date;
  readonly updatedAt?: Date;
}

/**
 * Provider-level outcome carrying submission certainty. Returned by
 * `IToolProvider.execute` so the governed gateway can enforce ambiguous
 * side-effect safety. `submitted`/`resultKnown` are tri-state at the boundary:
 * an in-flight attempt is UNKNOWN until the provider returns.
 */
export interface ToolProviderOutcome<TOutput = unknown> {
  /** True only once the request is positively known to have been submitted. */
  readonly submitted: boolean;
  /** True only when the provider outcome is definitively known. */
  readonly resultKnown: boolean;
  readonly retryable: boolean;
  readonly failureClassification?: string;
  readonly providerRequestId?: string;
  readonly output?: TOutput;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}
