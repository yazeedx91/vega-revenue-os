# Phase 09 — AI Execution Kernel Test Strategy

## Test Organization

Tests live in `packages/ai-runtime/src/__tests__/`. Shared test fixtures and helpers are in `fixtures.ts`.

| Suite | Focus |
| --- | --- |
| `agent-executor.spec.ts` | End-to-end execution pipeline: success, policy deny, approval gates, agent lifecycle, capabilities, tenant isolation, budget, deadline, tool failure, retry, output validation, checkpointing. |
| `planner.spec.ts` | Mission decomposition, phase templates, capability validation, tenant mismatch. |
| `reasoning-decision.spec.ts` | Structured reasoning parsing, free-text fallback, cross-tenant rejection, decision outcomes by policy/confidence/autonomy/risk. |
| `tool-executor.spec.ts` | Authorization, expiry, retryable vs non-retryable failures. |
| `output-validator.spec.ts` | Schema, forbidden values, allowed actions, PII detection, cross-tenant rejection. |
| `llm-router.spec.ts` | Provider selection, fallback, unsupported family. |
| `context-assembler.spec.ts` | Tenant-scoped memory/knowledge assembly, unauthorized exclusion. |
| `execution-state.spec.ts` | Budget tracking, failure classification, checkpoint save/load. |

## Design Principles

- All external dependencies are replaced with deterministic fakes.
- No network calls or real credentials are required.
- Cross-tenant access is asserted to fail at every bounded context.
- Retry behavior is verified with short, synchronous delays.

## Running the Tests

```bash
npx jest --testMatch="**/packages/ai-runtime/**/*.spec.ts"
```

## Known Notes

- `tsconfig.base.json` uses `moduleResolution: "node"` and `baseUrl`, which TypeScript 5.9 deprecates. The test transform ignores diagnostic code `5103` so tests compile without requiring broad config changes.
