# Product Completion Ledger

## Slice 4 Acceptance (R1, R3, R4)

| Requirement | Status | Evidence | Notes |
|---|---|---|---|
| R1 — Cognitive loop | PARTIAL | Partial acceptance; full cognitive-loop validation deferred to later slice | |
| R3 — AgentExecutor | PARTIAL | Partial acceptance; full AgentExecutor validation deferred to later slice | |
| R4 — 11 specialist agents | COMPLETE | All 11 production specialist implementations are registered, ACTIVE, selectable through the real Control Plane, resolved by `implementationKey`, invoked through `AgentExecutor`, and validated by `tests/e2e/phase14/slice4-specialists.spec.ts` | |

### Slice 4 Acceptance Invariants (not canonical requirement IDs)

- **AgentVersion immutability** — `ControlPlaneService.registerAgentVersion` performs semantic pre-check; `PostgresAgentRepository.saveVersion` uses `SELECT ... FOR UPDATE` transactional enforcement; `ImmutableAgentVersionConflict` is thrown for `APPROVED`/`ACTIVE`/`DEPRECATED`/`RETIRED` mutations.
- **System agents seed** — `SystemAgentsSeed` lifecycle progression is idempotent and skips past ACTIVE if already active; `PostgresAgentRepository.saveVersion` no-ops for identical definitions.
- **Regression gate** — `corepack pnpm -r typecheck` PASS, `corepack pnpm -r build` PASS, `corepack pnpm test` PASS with natural Jest exit, E2E 54/54 PASS with `--detectOpenHandles` PASS, `git grep` shows no skipped/`.only` tests; `apps/api` and `packages/shared` test scripts were corrected to use `--runInBand` to eliminate worker force-exit warnings.

## Slice 5 Acceptance (Production LLM Runtime)

| Requirement | Status | Evidence | Notes |
|---|---|---|---|
| Multi-provider LLM runtime | COMPLETE | `packages/llm-gateway` provides `ILLMProvider`, `ProviderRegistry`, `LLMRouter`, `OpenAIProvider`, and `AnthropicProvider`; `LLMRouter` performs capability/model-family routing, retry on retryable provider errors, and cross-provider fallback | OpenAI and Anthropic are the primary providers; provider readiness is fail-closed via `checkReadiness` |
| Production reasoning engine | COMPLETE | `ProductionReasoningEngine` uses `LLMRouter`, `StructuredOutputValidator`, bounded retries, and persists safe reasoning artifacts via `IReasoningArtifactRepository` | Raw chain-of-thought is not persisted; artifacts store rationale/conclusion/confidence/evidence/proposedActions/modelUsage/provider metadata |
| Structured output validation | COMPLETE | `StructuredOutputValidator` supports `OutputValidatorPolicy` with `SchemaDefinition` and per-request policy override | `REASONING_OUTPUT_POLICY` requires rationale/conclusion/confidence/evidence |
| Governance and budget enforcement | COMPLETE | `AgentExecutor` computes remaining budget, passes it to reasoning, and records `modelUsage` with provider and latency | `ModelUsage` extended with `provider` and `latencyMs` |
| Cost accounting and artifact persistence | COMPLETE | `PostgresInvocationAccounting` and `PostgresReasoningArtifactRepository` persist to `ai_runtime.llm_invocations` and `ai_runtime.reasoning_artifacts` | Migration `infra/database/migrations/019_slice5_llm_runtime.sql` adds both tables with RLS |
| Control-plane model catalog | COMPLETE | `ControlPlaneModelCatalog` adapts `IModelRepository` to `IModelCatalog` for `LLMRouter` | Wired in `apps/temporal-worker/src/activities.ts` |
| Cross-provider fallback | COMPLETE | `LLMRouter` falls back to the next eligible provider when the primary provider is not ready or fails | E2E coverage added in `tests/e2e/phase14/slice5-llm-runtime.spec.ts` |
| Regression gate | PASS | `pnpm -r typecheck` PASS, `pnpm -r build` PASS, `pnpm -r test` PASS, `pnpm -r test -- --detectOpenHandles` PASS, no skipped tests found | `packages/llm-gateway` 23 tests pass; `packages/ai-runtime` 44 tests pass |

## Verification Artifacts

- `packages/control-plane/src/domain.ts`: added `ImmutableAgentVersionConflict` error and `isMutableAgentLifecycle` guard.
- `packages/control-plane/src/application.ts`: `ControlPlaneService.registerAgentVersion` now reads existing version, no-ops on identical definitions, and throws `ImmutableAgentVersionConflict` for immutable lifecycle mismatches.
- `packages/control-plane/src/infrastructure.ts`: `PostgresAgentRepository.saveVersion` now runs in a transaction with `SELECT ... FOR UPDATE`, supports idempotent no-ops, and rejects mutations of immutable versions.
- `packages/control-plane/src/bootstrap/system-agents-seed.ts`: system specialist lifecycle progression is idempotent.
- `tests/e2e/phase14/agent-version-immutability.spec.ts`: covers idempotent re-seed, implementation key and capability conflict, new implementation acceptance, and concurrent writer rejection.
- `tests/e2e/phase14/slice4-specialists.spec.ts`: all 11 system specialists are registered, selectable, resolvable, and invoked via real Control Plane and `SpecialistImplementationRegistry`.

## Specialist Review

- **11 specialists** verified via the E2E `cases` table in `slice4-specialists.spec.ts`.
- **No fabricated future capabilities**: every specialist returns deterministic stubs and actions of `type: 'request_tool'` explicitly defer real integration to later slices (8, 10, 12, 13, 5, 6, etc.).
- **ComplianceSafetySpecialist authority boundary**: the specialist performs content/safety review and returns `FAILED`/`COMPLETED` outcomes; it does not override or skip Control Plane governance decisions (`AgentExecutor` still evaluates policy before execution).

## Slice 2 Acceptance (Mission Concurrency)

| Requirement | Status | Evidence | Notes |
|---|---|---|---|
| Mission repository optimistic concurrency | PASS | `PostgresMissionRepository.save` now uses CAS `UPDATE ... WHERE version = expected_version`, throws `ConcurrencyConflictError` on mismatch, and reloads the authoritative aggregate | Prevents blind overwrites by concurrent writers |
| Mission execution engine reconciliation | PASS | `MissionExecutionEngine.saveAndPublish` reloads the latest mission and re-applies the intended transition when a CAS conflict occurs; `runTask` aborts or continues based on the authoritative mission status and task status | Preserves Slice 2 lifecycle semantics |
| Pause/resume with no progression during pause | PASS | `tests/e2e/phase14/slice2-mission.spec.ts` 4/4 tests pass; `handleTaskResult` guards `mission.block` and allows `completeTask` to reconcile against a concurrently paused mission | No timeout increases or removed concurrency controls |
| Full regression gate | PASS | `pnpm test` (41 unit/integration tests), `pnpm test:e2e` (54 E2E tests) all green | Includes `slice2-mission`, `slice3-control-plane`, `slice4-specialists`, and the rest of the phase 14 E2E suite |

## Known Deviations

- Snyk code scan could not run locally because `SNYK_TOKEN` is not configured in this environment. The `security:snyk-code` script is available in `package.json` and should be executed in CI with a valid token.
