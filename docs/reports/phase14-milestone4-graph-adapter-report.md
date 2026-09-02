# Phase 14 — Milestone 4: Microsoft Graph Email Adapter + Atomic Idempotency Report

**Scope:** Implement a fully mocked/tested Microsoft Graph email adapter (`GraphEmailProvider implements IEmailProvider`), and close the Milestone 5 idempotency TOCTOU open risk with an atomic claim mechanism.
**Explicitly out of scope (not implemented):** live email sending, production/composition-root wiring, real Entra credentials, inbound webhook handling, Dynamics 365 writes, enabling the kill-switch.

## Overall Classification: 🟢 GREEN

No live send occurred at any point during this milestone. `GraphEmailProvider` is fully implemented and covered by 23 deterministic tests using `FakeTokenProvider`/`FakeGraphHttpClient` — zero network calls, zero real credentials. The Milestone 5 TOCTOU risk is closed via a new atomic `IIdempotencyStore.claim()` operation, verified by a dedicated 14-test suite plus a concurrency regression test in `send-safety-gate.spec.ts`.

---

## 1. Atomic Idempotency Claim (closes the Milestone 5 open risk)

- `packages/infrastructure/src/idempotency/idempotency-store.interface.ts` — added `claim<TResult>(ctx, scope, key, options?): Promise<IdempotencyClaimResult<TResult>>` to `IIdempotencyStore`. `get`/`set` are unchanged (additive change).
- `packages/infrastructure/src/idempotency/postgres-idempotency-store.ts` — `claim()` implemented as a single `INSERT ... ON CONFLICT (tenant_id, key, scope) DO UPDATE ... WHERE expires_at <= NOW() RETURNING ...` statement. Exactly one row is returned when the claim succeeds (fresh insert, or re-claiming an already-expired key); zero rows when a live conflicting record blocks it — no separate read-then-write race window.
- `packages/infrastructure/src/testing/in-memory-idempotency-store.ts` — matching `claim()` (synchronous check-then-set with no `await` in between, atomic by construction on Node's single-threaded event loop), plus TTL tracking added to `get()`/`set()` for parity.
- `packages/infrastructure/src/testing/fake-pg-pool.ts` — extended with dedicated `idempotency.keys` query-shape recognition (get/set/claim), including the conditional `WHERE expires_at <= NOW()` + `RETURNING` claim semantics, so the Postgres implementation can be exercised deterministically without a live database.
- `packages/outreach/src/safety/send-safety-gate.ts` — the old `get()`-then-later-`set(..., PENDING)` pattern (steps 8 and the tail of the method) was replaced with a single atomic `claim()` call, **moved to be the final check immediately before returning `ALLOW`** (after content validation, not before it — preserving the existing behavior that an `INVALID_CONTENT` denial never reserves the idempotency key).

## 2. Graph Email Adapter

Per the ARB architecture decision:

```
@azure/msal-node → ITokenProvider (existing abstraction) → GraphEmailProvider → IGraphHttpClient (native fetch) → Microsoft Graph REST API
```

- **`packages/infrastructure/src/identity/msal-token-provider.ts`** — `MsalTokenProvider`, a new implementation of the **existing** `ITokenProvider` interface (`packages/infrastructure/src/identity/entra-token-provider.ts`), backed by `@azure/msal-node`'s `ConfidentialClientApplication` client-credentials flow, colocated with the pre-existing `EntraTokenProvider`. MSAL's built-in in-memory token cache is relied upon as-is. Credentials are never passed as literals — callers must source them via `ISecretsProvider` (see the config contract doc).
- **`packages/outreach/src/infrastructure/graph/graph-http-client.interface.ts`** — `IGraphHttpClient`, a narrow single-operation (`sendMail`) HTTP boundary. No Graph SDK types cross this interface.
- **`packages/outreach/src/infrastructure/graph/fetch-graph-http-client.ts`** — `FetchGraphHttpClient`, calls the Graph `sendMail` REST endpoint directly via native `fetch` + `AbortController`-based timeout (default 30s). No Graph SDK dependency.
- **`packages/outreach/src/infrastructure/graph/graph-error-classifier.ts`** — maps Graph HTTP status/error body → `RetryClassification`: 429→`RATE_LIMITED` (with `Retry-After`-derived `retryAfterMs`, defaulting to 60s if absent), 401/403/other 4xx→`NON_RETRYABLE`, 5xx→`RETRYABLE`, unexpected/out-of-range status→`NON_RETRYABLE` with a diagnostic message.
- **`packages/outreach/src/infrastructure/graph/graph-email-provider.ts`** — `GraphEmailProvider implements IEmailProvider`. Performs **zero** policy decisions — no allowlist/suppression/approval/rate-limit/budget/idempotency/tenant-authorization logic; it only executes an already-authorized `ProviderSendRequest`. Maps `ProviderSendRequest` → Graph `sendMail` JSON; normalizes the response back to `ProviderSendResult`.
  - **Known, disclosed limitation:** Graph's `sendMail` returns `202 Accepted` with an empty body and no message ID synchronously. `providerMessageId` is therefore derived deterministically as `` `graph-${idempotencyKey}` `` rather than a true Graph `internetMessageId`. Capturing the real Graph message ID would require a follow-up Sent Items lookup — explicitly out of scope for this milestone.

## 3. Runtime Kill-Switch

- `OUTREACH_LIVE_EMAIL_ENABLED` — default-false (missing, `'false'`, or any non-`'true'` string is treated as disabled; only the exact string `'true'` enables). Checked in `GraphEmailProvider.send()` **immediately before the Graph HTTP send** (after token acquisition, per the approved design — token acquisition failures are still observable/auditable independent of the kill-switch state).
- On block: returns `{ status: 'FAILED', retryClassification: 'NON_RETRYABLE', providerErrorCode: 'LIVE_EMAIL_DISABLED', ... }` — observable via the existing `ProviderSendResult` → execution/audit path; no new audit mechanism was introduced.
- **Second, independent protection:** `GraphEmailProvider` is not registered into any production composition root. By direct inspection, no composition root wiring any `IEmailProvider` (including the pre-existing `StubEmailProvider`) exists anywhere in `apps/` today — confirmed via `grep_search` across `apps/temporal-worker/src`. There was nothing to accidentally wire, and nothing was added.
- Does not bypass, replace, or duplicate `SendSafetyGate`'s allowlist/suppression/approval/rate-limit/budget/idempotency controls — those run entirely upstream, before `provider.send()` is ever reached.

## 4. Configuration Contract

See `docs/reports/phase14-milestone4-graph-config-contract.md` — secret names (`GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, via `ISecretsProvider`) and environment variables (`GRAPH_SENDER_ADDRESS`, `OUTREACH_LIVE_EMAIL_ENABLED`, `GRAPH_SEND_TIMEOUT_MS`). No real values appear anywhere in the repository.

## 5. New Dependency

`@azure/msal-node` added to `packages/infrastructure/package.json`, colocated with the existing `@azure/identity`-based `EntraTokenProvider`. No Graph SDK dependency was added; `outreach` itself gained no new runtime dependency (it only depends on the `ITokenProvider` interface re-exported from `@projectx/infrastructure`).

## 6. Tests (37 new tests across 2 new files + 1 new test in an existing file, all passing)

| File | Tests |
|---|---|
| `packages/outreach/src/__tests__/graph-email-provider.spec.ts` | 23 — successful send with request-mapping assertions; token acquisition failure; Graph 401/403/429 (with and without `Retry-After`)/5xx; timeout; network error; malformed/unexpected response status; unparseable 400 error body; 9 kill-switch scenarios (missing/false/6 invalid-truthy-looking values/`'true'` proceeds); `checkHealth()` healthy/unhealthy. |
| `packages/infrastructure/src/__tests__/idempotency-claim.spec.ts` | 14 (7 × 2 implementations, `describe.each` over `InMemoryIdempotencyStore` and `PostgresIdempotencyStore` via `FakePgPool`) — fresh claim succeeds; second claim on a live key fails with `existing`; claim after `set(..., COMPLETED)` fails; tenant-scoping; scope-scoping; expired-claim re-claim; concurrent-claim race (exactly one of two simultaneous claims wins). |
| `packages/outreach/src/__tests__/send-safety-gate.spec.ts` (updated) | +1 new test — two parallel `SendSafetyGate.evaluate()` calls for the same idempotency key resolve to exactly one `ALLOW` and one `DENY`/`DUPLICATE_SEND`, isolating the atomic-claim mechanism from the `OutreachMessageExecution` aggregate's own shared-state guards. The pre-existing duplicate-send test's denial-message assertion was updated to match the new reason text (`"already has an in-flight or completed send reserved"`); no test was weakened or removed. |

## 7. Validation Results

| Check | Result |
|---|---|
| `pnpm --filter @projectx/infrastructure build` | ✅ PASS |
| `pnpm --filter @projectx/outreach build` | ✅ PASS |
| `pnpm --filter @projectx/mission-orchestrator build` | ✅ PASS |
| `pnpm --filter @projectx/conversation build` | ✅ PASS |
| `pnpm --filter temporal-worker build` | ✅ PASS |
| Targeted (`graph-email-provider`, `idempotency-claim`, `send-safety-gate`) | ✅ 57 tests PASS |
| Full repo-wide `jest` | ✅ **42 suites / 242 tests PASS** (up from 40/204 in the Milestone 5 baseline: +2 suites, +38 tests), **zero regressions** |

## 8. Security Review

| Concern | Finding |
|---|---|
| **Idempotency TOCTOU (Milestone 5 §6 open risk)** | **Closed.** Verified by a dedicated concurrency test at both the store level (`idempotency-claim.spec.ts`) and the `SendSafetyGate` level (`send-safety-gate.spec.ts`) — exactly one of two simultaneous claims/evaluations for the same key ever succeeds, for both the Postgres (`FakePgPool`-backed) and in-memory implementations. |
| **Live-send prevention** | Two independent layers hold simultaneously: (1) the kill-switch defaults to disabled and requires the exact string `'true'`; (2) `GraphEmailProvider` is not wired into any composition root. Either alone would already prevent a live send; both are in place. |
| **Kill-switch bypass** | Cannot be bypassed by any allowlist/approval/rate-limit/budget state — it is checked independently inside the adapter itself, downstream of (never in place of) `SendSafetyGate`. Explicitly tested: 6 distinct non-`'true'` string values, plus the missing-variable case, all block the send. |
| **Secret handling** | `MsalTokenProvider` only ever receives already-resolved secret *values* passed in by the caller — the class itself has no knowledge of `ISecretsProvider` secret *names*; those live only in the config contract doc and caller composition code, never hardcoded, logged, or embedded in domain/application/workflow state. |
| **Adapter cannot bypass safety boundary** | Confirmed by design and by the existing Milestone 5 finding (unchanged in this milestone): `provider.send()` is called from exactly one place (`OutreachExecutionService.executeApprovedSend`), always immediately after `SendSafetyGate.evaluate()` returns `ALLOW`. `GraphEmailProvider` implements no allowlist/suppression/approval/rate-limit/budget/idempotency/tenant-authorization logic of its own. |
| **Graph message-ID limitation** | Disclosed in §2. `providerMessageId` is derived from the idempotency key, not a true Graph `internetMessageId`. No functional risk to duplicate-detection (idempotency is keyed independently), but downstream systems expecting a real Graph message ID for correlation (e.g., a future read-receipt/reply-matching feature) would need the follow-up Sent Items lookup this milestone did not implement. |

## 9. Known Remaining Gaps (disclosed, not silently accepted)

1. **Graph message-ID derivation** (§2, §8) — follow-up Sent Items lookup needed for a true `internetMessageId`, if ever required.
2. **No live Postgres/Redis validation** — as in Milestone 5, all persistence-shaped tests use `FakePgPool`/in-memory doubles; real Postgres `INSERT ... ON CONFLICT ... WHERE ... RETURNING` semantics were verified by SQL review, not against a live database.
3. **No composition-root wiring exists yet for any `IEmailProvider`** (not a regression — this was already true before this milestone, and remains intentionally untouched here).

## 10. Guarantee-by-Guarantee Classification

| # | Requirement | Status |
|---|---|---|
| 1 | Microsoft Graph adapter implements `IEmailProvider`, zero policy logic of its own | 🟢 GREEN |
| 2 | MSAL/Graph types confined behind `ITokenProvider`/`IGraphHttpClient` | 🟢 GREEN |
| 3 | Deterministic tests, no network calls | 🟢 GREEN — 23 tests, `FakeTokenProvider`/`FakeGraphHttpClient` |
| 4 | Retry classification (401/403/429/5xx/timeout/malformed) | 🟢 GREEN |
| 5 | Runtime kill-switch, default-false, exact-`'true'`-only | 🟢 GREEN — 9 dedicated tests |
| 6 | No production wiring | 🟢 GREEN — confirmed by inspection |
| 7 | Atomic idempotency claim (Milestone 5 TOCTOU closure) | 🟢 GREEN — 14 + 1 dedicated tests, both store implementations |
| 8 | No real credentials, no live send | 🟢 GREEN |
| 9 | Full validation (builds + full test suite, zero regressions) | 🟢 GREEN — 42 suites / 242 tests |

**STOP condition honored.** No production/composition-root wiring, no inbound webhook work, no real credentials, no enabling of the kill-switch, and no Dynamics 365 writes were performed.
