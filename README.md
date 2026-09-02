# ProjectX — AI-Native Autonomous Revenue Employee

Production-grade TypeScript/NestJS monorepo foundation.

## Workspace

- pnpm workspace (`apps/*`, `packages/*`)
- TypeScript 5.x strict mode
- ESLint, Prettier, Jest

## Apps

- `apps/api` — NestJS modular monolith
- `apps/ai-worker` — AI execution worker
- `apps/background-worker` — generic background worker
- `apps/temporal-worker` — Temporal worker host

## Packages

- `packages/domain` — DDD aggregates, value objects, repository interfaces
- `packages/infrastructure` — cache, event bus, persistence, workflow, CRM, identity, observability adapters
- `packages/ai-runtime` — agent runtime, LLM/tool clients, policy client
- `packages/shared` — event, command, tool, AI execution, mission, agent, task contracts
- `packages/tool-gateway` — tool gateway and provider interfaces
- `packages/llm-gateway` — LLM gateway and provider interfaces

## Scripts

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test
pnpm lint
```

## Notes

- Business logic, database schemas, provider SDK integrations, credentials, and deployments are out of scope for Phase 07.
- `PRODUCT-CONSTITUTION-MISSING` is tracked as an explicit dependency.
- `Temporal-on-Azure` deployment topology remains a Phase 07 validation item.