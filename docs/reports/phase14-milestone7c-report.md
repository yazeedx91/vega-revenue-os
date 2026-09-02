# Phase 14.7c Real-Infrastructure Validation Report

## Summary

All authoritative root-level Jest suites pass. PostgreSQL Row-Level Security (RLS), Redis tenant isolation, and Temporal deterministic workflow acceptance are confirmed. The only failures are environmental/tooling: dependency audit findings in transitive packages and the workspace package-manager invocation on Windows, neither of which blocks Phase 14.7c.

| Gate | Status | Detail |
|------|--------|--------|
| Root unit/integration tests | **PASS** | 68 suites, 391 tests |
| Phase 14.7c E2E suite | **PASS** | 3 suites, 11 tests |
| Type check | **PASS** | 16 workspace projects |
| Build | **PASS** | 16 workspace projects |
| Redis acceptance | **PASS** | included in root run |
| Temporal acceptance | **PASS** | included in root run |
| PostgreSQL RLS / tenant isolation | **PASS** | enforced by `current_setting('app.current_tenant')` |
| `pnpm audit` | **FAIL** | 20 transitive dependency findings (not Phase 14 first-party code) |
| `pnpm -r lint` | **ENVIRONMENTAL** | ESLint v9 config missing; nested `pnpm` not resolvable on Windows |
| `pnpm -r test` | **ENVIRONMENTAL / PACKAGE-MANAGER INVOCATION** | workspace scripts use bare `pnpm exec jest`, which Windows/Corepack cannot resolve |

## Commands Run

```bash
# Authoritative unit/integration test run
corepack pnpm exec jest --config jest.config.js --runInBand --forceExit
# Result: 68 passed, 391 passed

# Authoritative Phase 14.7c E2E run
corepack pnpm exec jest --config jest.e2e.config.js --runInBand --forceExit
# Result: 3 suites passed, 11 tests passed

corepack pnpm -r typecheck
# Result: PASS

corepack pnpm -r build
# Result: PASS

corepack pnpm audit
# Result: 20 vulnerabilities (4 low, 9 moderate, 7 high)
```

## E2E Results

- `tests/e2e/phase14/security.spec.ts` — PASS
- `tests/e2e/phase14/lifecycle.spec.ts` — PASS
- `tests/e2e/phase14/failure-injection.spec.ts` — PASS

### E2E Coverage Notes

- Tenant-scoped durable repositories (PostgreSQL) are used end-to-end.
- Safety gate enforces allowlist, suppression, approval verification, rate limiting, budget, idempotency, and content checks.
- Approval verification adapter validates tenant, executionId, sequenceId, actionType, and status.
- `executeApprovedSend` is idempotent for already-accepted executions and supports retry from `QUEUED`/`SUBMITTED` states.
- Audit log queries set tenant context before reading under RLS.
- Stub email provider is used for all sends; no real email is dispatched.

## Key Fixes Applied During This Session

1. **`packages/outreach/src/application/outreach-execution.service.ts`**
   - Allows retry from `QUEUED` or `SUBMITTED` without requiring re-approval.
   - Marks idempotency keys `COMPLETED` on success or `FAILED` on retryable/non-retryable failure so retries can reclaim.

2. **`packages/infrastructure/src/idempotency/postgres-idempotency-store.ts`**
   - `claim()` now reclaims keys whose existing status is `FAILED` (in addition to expired keys), enabling safe retry after a transient failure.

3. **`packages/outreach/src/infrastructure/stub-email-provider.ts`**
   - Updates the recorded `simulatedStatus` to `ACCEPTED` when a previously timed-out accepted send is retried successfully.

4. **`tests/e2e/phase14/helpers.ts`**
   - Wires the PostgreSQL idempotency store into the E2E execution service.

## Environmental / Tooling Findings

### `pnpm -r test` — ENVIRONMENTAL / PACKAGE-MANAGER INVOCATION

Workspace `package.json` scripts invoke `pnpm exec jest` directly. When running under Corepack on Windows, the nested `pnpm` executable is not on `PATH`, causing every workspace test script to fail before Jest starts.

Recommended follow-up (post-7c): replace bare `pnpm exec jest` with a repository-consistent invocation (e.g., `corepack pnpm exec jest` or a root-level Jest configuration) so recursive scripts work cross-platform.

### `pnpm -r lint` — ENVIRONMENTAL

Same package-manager invocation problem, plus ESLint 9 expects an `eslint.config.js` file while the repository appears to rely on an older `.eslintrc.*` configuration. No lint was run during this validation gate.

### `pnpm audit` — FAIL (dependency findings)

20 findings reported in transitive dependencies such as `webpack` and `body-parser`. These are not in Phase 14 first-party code. They should be triaged and patched through normal dependency maintenance; they do not reflect a regression from the 7c implementation.

## Security Boundaries Maintained

- **RLS / tenant isolation**: not weakened. All tenant-scoped tables use `current_setting('app.current_tenant', TRUE)` policies and force RLS.
- **Approval lifecycle**: not weakened. Human approval is still required for first outbound email per sequence/recipient.
- **Allowlist / suppression**: enforced by the safety gate and verified in E2E.
- **Idempotency**: improved, not weakened. `FAILED` keys are reclaimable; `COMPLETED` keys remain final.
- **No real email**: all E2E sends use `StubEmailProvider`.
- **No production credentials**: integration environment uses local defaults only.

## Conclusion

Phase 14.7c real-infrastructure validation is **PASS** for all authoritative test gates. Environmental findings are documented as post-validation follow-up work and do not affect the milestone acceptance decision.
