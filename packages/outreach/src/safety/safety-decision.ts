export type SafetyDenialCode =
  | 'INVALID_TENANT_CONTEXT'
  | 'NOT_ALLOWLISTED'
  | 'SUPPRESSED'
  | 'APPROVAL_NOT_FOUND'
  | 'APPROVAL_WRONG_TENANT'
  | 'APPROVAL_WRONG_TARGET'
  | 'APPROVAL_EXPIRED'
  | 'APPROVAL_REJECTED'
  | 'APPROVAL_CANCELLED'
  | 'APPROVAL_PENDING'
  | 'APPROVAL_INVALID_ACTION_TYPE'
  | 'RATE_LIMITED'
  | 'REDIS_UNAVAILABLE'
  | 'BUDGET_SEND_COUNT_EXCEEDED'
  | 'BUDGET_COST_EXCEEDED'
  | 'DUPLICATE_SEND'
  | 'INVALID_CONTENT';

export type SafetyDecision =
  | { readonly decision: 'ALLOW' }
  | { readonly decision: 'DENY'; readonly code: SafetyDenialCode; readonly reason: string }
  | { readonly decision: 'RETRYABLE'; readonly code: SafetyDenialCode; readonly reason: string; readonly retryAfterMs?: number };

export function isAllowed(decision: SafetyDecision): decision is { decision: 'ALLOW' } {
  return decision.decision === 'ALLOW';
}
