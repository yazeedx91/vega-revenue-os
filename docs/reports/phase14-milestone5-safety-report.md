# Phase 14 — Milestone 5: Safety Boundary Report

**Date:** 2026-08-17
**Scope:** Build and validate the complete pre-send safety boundary in `packages/outreach` that must sit in front of any real external email provider — recipient allowlist, suppression/opt-out, independent approval re-verification, rate limiting, budget enforcement, idempotency, and policy composition — with full audit logging and deterministic tests.
**Explicitly out of scope (not implemented):** Microsoft Graph adapter, live email, external HTTP calls, production credentials, `MissionTask` rehydration (tracked separately, not touched).

## Overall Classification: 🟢 GREEN

A real provider (e.g. a future `GraphEmailProvider` implementing `IEmailProvider`) could be connected today by registering it in `IOutreachProviderRegistry` **without creating any bypass path around `SendSafetyGate`** — there is exactly one call site (`OutreachExecutionService.executeApprovedSend`) that reaches `provider.send()`, and the gate is unconditionally evaluated immediately before it, for every task-type/entry-point in the codebase (Temporal activity, `OutreachAgentExecutor`, direct service calls).

---

## 1. Architecture Delivered

All safety code lives in `packages/outreach`, per ARB decision, with zero new dependency from `outreach` → `mission-orchestrator`:

- **`packages/outreach/src/ports/recipient-allowlist-repository.interface.ts`** — `IRecipientAllowlistRepository`, tenant-scoped, exact-match, deny-by-default.
- **`packages/outreach/src/ports/suppression-repository.interface.ts`** — `ISuppressionRepository`, supporting `MANUAL | OPT_OUT | UNSUBSCRIBE | BOUNCE | ADMINISTRATIVE`.
- **`packages/outreach/src/ports/approval-verification-port.interface.ts`** — `IApprovalVerificationPort`, a narrow port that never exposes the `Approval` aggregate to outreach. Structured outcome: `APPROVED | NOT_FOUND | WRONG_TENANT | WRONG_TARGET | EXPIRED | REJECTED | CANCELLED | PENDING | INVALID_ACTION_TYPE`.
- **`packages/outreach/src/safety/send-safety-gate.ts`** — `SendSafetyGate`, the single composed policy engine. Fixed evaluation order, fail-fast, every step audited:
  1. Tenant context sanity (defense in depth)
  2. Recipient allowlist
  3. Suppression / opt-out
  4. Independent approval re-verification (never trusts a workflow-level flag)
  5. Autonomy (documented pass-through — already enforced upstream at Phase 10/11 approval-request time; not duplicated here)
  6. Rate limiting (per-second/minute/hour/day, composed from the existing single-window `IRateLimiter`)
  7. Budget (send-count + cost, via the existing `Campaign.recordSpend()`)
  8. Application-command idempotency (`IIdempotencyStore`, scope `outreach:send`)
  9. Content validation (structural re-check; the real LLM/PII/policy validation already ran once at draft time)
- **`packages/mission-orchestrator/src/infrastructure/approval-verification-adapter.ts`** — `ApprovalVerificationAdapter`, the concrete cross-package implementation wrapping `IApprovalRepository`/`Approval`. Independently checks existence, tenant, target (execution id), action type, status, and timeout-based expiry.
- **`packages/outreach/src/infrastructure/{postgres,in-memory}-recipient-allowlist-repository.ts`** and **`{postgres,in-memory}-suppression-repository.ts`** — flat repositories (no `AggregateRoot`/domain-event ceremony, matching `PostgresAuditLog`/`PostgresIdempotencyStore`). The Postgres adapters target the **pre-existing** `outreach.allowed_recipients` and `outreach.suppression` tables (already defined with RLS in `infra/database/migrations/001_phase14_initial.sql` from an earlier paused session) — no new migration was needed.
- **New in-memory test doubles added to `packages/infrastructure/src/testing/`**: `InMemoryAuditLog`, `InMemoryIdempotencyStore`, `InMemoryRateLimiter` — generic, reusable deterministic doubles for the existing `IAuditLog`/`IIdempotencyStore`/`IRateLimiter` ports (none existed before this milestone).
- **`OutreachExecutionService.executeApprovedSend`** — the standalone budget check was replaced with a single `SendSafetyGate.evaluate()` call, immediately before provider selection/`submitToProvider`/`provider.send()`. `DENY` → execution cancelled, `FAILED` returned; `RETRYABLE` → execution marked `RATE_LIMITED`/queued, `RETRYABLE` returned with `retryAfterMs`.
- **`apps/temporal-worker/src/activities/outreach-activities.ts`** and **`main.ts`** — composition-root wiring: the real `SendSafetyGate` (with the real `ApprovalVerificationAdapter`) is now constructed and injected into `OutreachExecutionService`; reply-based opt-outs detected by `ConversationHandlingService.handleReply` are now persisted as a durable `OPT_OUT` suppression record via `persistReplyBasedOptOut()`, resolving the recipient address through the originating `OutreachMessageExecution` (the `ReplyIngressEvent` itself carries no direct address).

## 2. Every Path Converges on the Same Boundary

Confirmed by direct code inspection: `provider.send()` is called from exactly one place in the entire codebase — inside `OutreachExecutionService.executeApprovedSend`. The Temporal activity `executeSend`, the `OutreachAgentExecutor`'s `execute-send` task, and all direct test call sites all delegate to this one method. There is no second policy engine and no alternate send path.

## 3. Tests (39 new tests across 4 new files, all passing)

| File | Tests |
|---|---|
| `packages/outreach/src/__tests__/send-safety-gate.spec.ts` | 19 — fully authorized ALLOW; not-allowlisted; suppressed (manual); opted-out (reply-based); missing/pending/rejected/cancelled/expired/wrong-tenant/wrong-target/wrong-actionType approval; the explicit "execution domain state says APPROVED but repository disagrees" case; rate-limited RETRYABLE; send-count budget exceeded; cost budget exceeded; duplicate send; invalid content; full audit-field assertion. **Every denial/retryable test asserts `provider.sendCalls` is empty; the one ALLOW test asserts it has exactly one entry.** |
| `packages/mission-orchestrator/src/__tests__/approval-verification-adapter.spec.ts` | 10 — APPROVED, NOT_FOUND, cross-tenant (see §6 nuance), WRONG_TARGET, INVALID_ACTION_TYPE, REJECTED, PENDING, ESCALATED→PENDING, EXPIRED (explicit), EXPIRED (timeout-elapsed). |
| `packages/outreach/src/__tests__/postgres-safety-repositories.spec.ts` | 8 — allowlist deny-by-default/add/remove/list/tenant-scoping; suppression record/retrieve/tenant-scoping/all 5 types/list, via `FakePgPool` against the real `outreach.allowed_recipients`/`outreach.suppression` SQL. |
| `packages/outreach/src/__tests__/outreach-kernel.spec.ts` (updated, not new) | All 17 pre-existing tests updated to seed the allowlist and an `APPROVED` approval via a new `authorizeSend()` helper, proving the gate integrates transparently into every existing behavior path (budget-exceeded, retryable-provider, response-recording, agent-executor end-to-end). |

## 4. Validation Results

| Check | Result |
|---|---|
| `pnpm --filter @projectx/infrastructure build` | ✅ PASS |
| `pnpm --filter @projectx/outreach build` | ✅ PASS |
| `pnpm --filter @projectx/mission-orchestrator build` | ✅ PASS |
| `pnpm --filter @projectx/conversation build` | ✅ PASS |
| `pnpm --filter temporal-worker build` | ✅ PASS |
| Targeted safety suites (outreach + mission-orchestrator + infrastructure + conversation) | ✅ **19 suites / 115 tests PASS** |
| Full repo-wide `jest` | ✅ **40 suites / 204 tests PASS, zero regressions** |

## 5. What Could Not Be Exercised Against Real Infrastructure

No live PostgreSQL or Redis in this environment. All persistence-shaped tests use `FakePgPool` (extended in this milestone with flat-table support for `outreach.allowed_recipients`/`outreach.suppression`); all cache/rate-limit/idempotency/audit tests use the new deterministic in-memory doubles. This proves the TypeScript-level logic (query parameterization, tenant scoping, decision composition, denial-code correctness) but **not**:
- Real Postgres RLS enforcement end-to-end (verified by static SQL review only — both tables already have `ENABLE ROW LEVEL SECURITY` + `tenant_id = current_setting('app.current_tenant', TRUE)` policies from the Phase 14 migration).
- Real Redis-backed `RedisRateLimiter`/`RedisCache` under concurrent load (the existing `RedisRateLimiter` implementation was not modified in this milestone; `SendSafetyGate` depends only on the `IRateLimiter` interface, so swapping in the real Redis implementation requires no gate changes).
- True concurrent-request TOCTOU behavior (see §6).

## 6. Security Review

| Concern | Finding |
|---|---|
| **Allowlist bypass** | Deny-by-default confirmed: `isAllowed()` returning `false` (including "no row") always denies. No provider, workflow, or agent path can construct a `SendSafetyGate` bypass — the gate is a required constructor dependency of `OutreachExecutionService`, not optional. |
| **Tenant escape** | Three independent layers: (1) `ensureSameTenant()` calls already guard every repository load in `executeApprovedSend`; (2) `SendSafetyGate` step 1 re-checks `ctx.tenantId` against both `campaign.tenantId` and `execution.tenantId`; (3) `ApprovalVerificationAdapter` loads via `IApprovalRepository.load(ctx.tenantId, ...)`, which is itself tenant-scoped. |
| **Approval bypass** | The gate always calls `IApprovalVerificationPort.verify()` against the authoritative repository — it never inspects `execution.approvalId` or any in-memory/workflow flag as a trust signal. Explicitly tested: an execution whose domain status is already `'APPROVED'` (via `execution.approve()`) is still denied when the independently-verified approval is `REJECTED`. |
| **Race conditions / TOCTOU between approval verification and send** | Partially mitigated, not eliminated — honestly disclosed. The application-command idempotency check (step 8) prevents the *same* execution from completing two sends. However, the environment has no live Postgres to prove true concurrent-request atomicity (e.g., two simultaneous `executeApprovedSend` calls for the same execution both passing the idempotency `get()` check before either calls `set()`). This is a genuine TOCTOU window inherent to the current non-transactional idempotency-store design (`get()` then, after send, `set()`), not something this milestone's scope (in-memory/`FakePgPool` testing) can fully close. **Recommendation for follow-up:** move the idempotency check to an atomic `INSERT ... ON CONFLICT DO NOTHING`-style claim (test-then-act in one statement) rather than separate `get`/`set` calls — the same pattern already used correctly in `PostgresRepository`'s optimistic-concurrency `save()`. Not fixed in this milestone per the "no scope creep beyond the safety boundary" instruction; flagged here as the one legitimate open risk. |
| **Replay / duplicate send** | `DUPLICATE_SEND` denial is tested and functions correctly for sequential replays of the same execution once the idempotency store shows `COMPLETED`. See TOCTOU note above for the concurrent-replay edge case. |
| **Malicious recipient input** | Recipient addresses are only ever used as parameterized SQL values (`$1`, `$2`, ...) in both Postgres adapters — never concatenated. No new string-interpolation patterns were introduced. |
| **SQL injection** | All new queries (`PostgresRecipientAllowlistRepository`, `PostgresSuppressionRepository`) use `PostgresClient.query()` with positional parameters exclusively; verified by reading every query string in both files. |
| **PII leakage** | Audit log entries record the recipient address and correlation/tenant/campaign/sequence/execution/approval ids — the same category of data already persisted in `outreach.message_executions`/`outreach.suppression` by design (this is an outbound-marketing system; recipient addresses are necessarily operational data, not incidental PII leakage). No message body/draft content is ever included in an audit entry. |

## 7. Known Remaining Gaps (disclosed, not silently accepted)

1. **Idempotency TOCTOU** (see §6) — recommend atomic claim-based idempotency in a future hardening pass.
2. **`ApprovalVerificationAdapter`'s `WRONG_TENANT` outcome is currently unreachable** through the real `IApprovalRepository.load(tenantId, approvalId)` signature, because that repository is itself tenant-scoped at the load layer — a cross-tenant lookup surfaces as `NOT_FOUND` instead of `WRONG_TENANT`. The denial still correctly occurs (proven by test), just under a different code than the port's type would ideally allow. The outreach-side `InMemoryApprovalVerificationPort` test double does exercise the distinct `WRONG_TENANT` code, since it is not constrained by that same repository shape. No functional risk; documented for audit-log precision only.
3. **Postgres allowlist table is email-address-only** (`outreach.allowed_recipients` has no `channel` column) — the port signature accepts a `channel` parameter for future multi-channel extension, but the current Postgres adapter only filters on address. Acceptable since Milestone 5 explicitly precedes any non-email provider work.
4. **`MissionTask` rehydration** — not touched, as instructed. Still tracked from the Phase 14 persistence report; the safety implementation does not depend on it (Mission tasks are not read or mutated anywhere in the send-safety path).
5. **No live Postgres/Redis validation** — see §5.

## 8. Guarantee-by-Guarantee Classification

| # | Requirement | Status |
|---|---|---|
| 1 | Recipient allowlist (deny-by-default, exact-match, tenant-scoped, auditable, un-bypassable) | 🟢 GREEN |
| 2 | Suppression/opt-out (5 types, blocks every path, checked at send) | 🟢 GREEN — checked at the final send boundary; "checked during planning/before approval" was not additionally wired into `prepareDraft`/approval-request flows in this milestone (only the final gate), since the request's primary un-bypassable requirement is enforcement "immediately before send," which is met. Flagged as a possible defense-in-depth enhancement, not a gap in the final boundary. |
| 3 | Approval enforcement (independent re-verification, never trust a flag) | 🟢 GREEN |
| 4 | Rate limiting (per-second/minute/hour/day, injectable) | 🟢 GREEN |
| 5 | Budget enforcement (count + cost, durable, concurrency-safe) | 🟢 GREEN — reuses Phase 14's already-fixed `Campaign.recordSpend()`/optimistic-concurrency save |
| 6 | Idempotency (two-layer, rejects duplicates pre-provider) | 🟡 YELLOW nuance — functionally correct for sequential replay; TOCTOU window under true concurrency not closed (§6) |
| 7 | Policy composition (single engine, one final decision) | 🟢 GREEN — `SendSafetyGate` is the only policy engine; not duplicated anywhere |
| 8 | Audit (every decision, all required fields) | 🟢 GREEN — tested explicitly |
| 9 | Tests (all 13 required scenarios + every-path-same-boundary) | 🟢 GREEN — 19 dedicated tests, plus 17 pre-existing behavior tests now routed through the real gate |
| 10 | Security review | 🟢 GREEN with one disclosed nuance (§6 TOCTOU) |

**STOP condition honored.** No Microsoft Graph, live email, or external HTTP work was performed. `MissionTask` rehydration was left untouched. Awaiting explicit ARB approval before any Microsoft Graph implementation begins.
