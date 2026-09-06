import type { TenantContext } from '@projectx/domain';
import type { IToolProvider } from './tool-provider.interface';
import type { ToolCallRequest, ToolDefinition } from '@projectx/shared';

/** Authoritative policy decision for a tool call (Control Plane / trusted path). */
export interface ToolPolicyDecision {
  readonly decision: 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';
  readonly policyDecisionId: string;
  readonly capabilities: readonly string[];
  readonly autonomyAllowed: boolean;
  readonly reason?: string;
}

/**
 * Authoritative policy evaluator. The agent cannot self-authorize — this is
 * backed by the Control Plane / trusted policy path, not by agent-supplied
 * authorization.
 */
export interface IToolPolicyEvaluator {
  evaluate(ctx: TenantContext, request: ToolCallRequest, definition: ToolDefinition): Promise<ToolPolicyDecision>;
}

/**
 * Exact approval binding: verifies that a granted approval matches the exact
 * tool_id + version + action + input-hash + tenant + mission + expiry. A
 * generic or stale approval does not satisfy the binding.
 */
export interface IToolApprovalBinding {
  verify(
    ctx: TenantContext,
    request: ToolCallRequest,
    definition: ToolDefinition,
    inputHash: string,
  ): Promise<{ approved: boolean; approvalId?: string; reason?: string }>;
}

/** Runtime provider readiness — checked BEFORE the idempotency claim. */
export interface IToolProviderReadiness {
  isReady(providerId: string, definition: ToolDefinition): Promise<boolean>;
}

/** Resolve the provider adapter for a definition (routing by provider_id). */
export interface IToolProviderResolver {
  resolve(providerId: string, definition: ToolDefinition): IToolProvider | undefined;
}
