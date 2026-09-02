# Phase 08: Policy Boundary

## Port

```ts
type PolicyDecision = 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';

interface IPolicyService {
  evaluate(ctx: { tenantId: TenantId }, action: PolicyAction): Promise<PolicyDecision>;
}
```

Policy decisions are produced for sensitive actions before domain mutation. `REQUIRE_APPROVAL` is a valid decision returned by the port; concrete handling of approval workflows is out of scope for Phase 08.

## Usage

Command handlers call `policyService.evaluate(...)` before invoking aggregate mutators. If the decision is `DENY`, the handler returns an `AuthorizationError` without persisting changes.

## Test double

`FixedPolicyService` always returns a configured decision (`ALLOW` by default), enabling deterministic tests for both success and denial paths.

## Future integration

A real adapter will transform command/action metadata into an `AIExecutionRequest` and invoke the approved `IPolicyClient` from `@projectx/ai-runtime` or the control plane. Phase 08 keeps this as a port so adapters can be swapped in later without touching domain/application code.
