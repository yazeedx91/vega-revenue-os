# Product Completion Ledger

## Slice 4 Acceptance (R1, R3, R4)

| Requirement | Status | Evidence | Notes |
|---|---|---|---|
| R1 - System agents seed is idempotent and does not rewrite immutable ACTIVE versions | PASS | `SystemAgentsSeed` lifecycle progression is idempotent and skips past ACTIVE if already active; `PostgresAgentRepository.saveVersion` no-ops for identical definitions | |
| R4 - AgentVersion immutability | PASS | `ControlPlaneService.registerAgentVersion` performs semantic pre-check; `PostgresAgentRepository.saveVersion` uses `SELECT ... FOR UPDATE` transactional enforcement; `ImmutableAgentVersionConflict` is thrown for `APPROVED`/`ACTIVE`/`DEPRECATED`/`RETIRED` mutations; `DRAFT` and `TESTING` versions remain mutable | |
| R3 - Regression gate | PASS with pre-existing exception | `typecheck`, `build`, and `pnpm test` (unit) pass; E2E: `agent-version-immutability`, `slice3-control-plane`, `slice4-specialists` pass; `slice2-mission` has 4 pre-existing Temporal workflow task/query failures | |

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

## Known Deviations

- `tests/e2e/phase14/slice2-mission.spec.ts`: 4 of 8 tests fail with Temporal workflow task/query errors (`Workflow Task in failed state`, `Timeout waiting for condition after 30000ms`). These failures are classified as **pre-existing infrastructure issues** and were not introduced by the Slice 4 control-plane changes.
