import type { TenantContext } from '@projectx/domain';

/**
 * Binding keys that identify whether an approval is bound to a specific
 * execution/action. Mirrors the binding enforced by the authoritative
 * Approval aggregate (executionId + actionType + idempotencyKey).
 */
export interface ExecutionApprovalBinding {
  readonly executionId: string;
  readonly idempotencyKey: string;
  /** Optional additional filter — matched against the approval's actionType when provided. */
  readonly actionType?: string;
}

/**
 * Provenance for a bound approval that satisfied a REQUIRE_APPROVAL gate.
 * Recorded in execution results/audit so the authoritative approval evidence
 * (which approval, that it validated) is retained alongside the original
 * policy decision — the synthetic execution-local ALLOW is never persisted.
 */
export interface ExecutionApprovalEvidence {
  /** Identifier of the bound approval row/aggregate that satisfied the gate. */
  readonly approvalId: string;
  /** Approval status observed at validation time (e.g. 'APPROVED'). */
  readonly status: string;
  /** Validation outcome for the binding (always 'valid' when returned). */
  readonly validation: 'valid';
}

/**
 * Narrow port used by the AgentExecutor to check whether a valid, current,
 * bound approval already exists for an execution when policy returns
 * REQUIRE_APPROVAL. The implementation is backed by the existing Approval
 * aggregate / mission.approvals table — it does NOT create a second approval
 * authority, it only reads the existing binding.
 */
export interface IExecutionApprovalBinding {
  /**
   * Returns true when a valid (APPROVED, unexpired, target-matched) approval is
   * bound to the given execution/action/idempotency key for the current tenant.
   */
  hasValidApproval(ctx: TenantContext, binding: ExecutionApprovalBinding): Promise<boolean>;

  /**
   * Optional: resolve the bound approval and return its provenance evidence
   * (approval id + validation result) so the executor can record which approval
   * satisfied the gate. When absent the executor falls back to the boolean
   * {@link hasValidApproval} check and records no approval id.
   */
  resolveValidApproval?(
    ctx: TenantContext,
    binding: ExecutionApprovalBinding,
  ): Promise<ExecutionApprovalEvidence | null>;
}
