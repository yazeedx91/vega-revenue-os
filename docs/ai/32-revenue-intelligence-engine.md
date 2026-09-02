# Phase 11 — AI-Native Revenue Intelligence & Lead Generation Engine

This document describes the Phase 11 runtime: an evidence-backed, Dynamics-365-first pipeline that transforms missions/ICPs into qualified leads. It reuses the Phase 10 Mission Orchestrator for durable execution and approvals.

## Scope

- ICP profile definition and evaluation
- Account discovery and company intelligence
- Contact discovery, enrichment, and validation
- Buying/intent signal detection
- Evidence collection with provenance and confidence
- Lead qualification and deterministic scoring
- Tenant isolation, audit, cost controls, and failure handling
- Integration with `packages/mission-orchestrator`

Out of scope for Phase 11: outreach, email, LinkedIn messaging, meeting booking, or any autonomous external communication.

## Package Structure

| Package | Responsibility |
| --- | --- |
| `packages/domain` | `ICPProfile`, `Account`, `Contact`, `Lead`, `ResearchEvidence` aggregates and events |
| `packages/infrastructure` | Intelligence repository ports |
| `packages/intelligence` | Research engine, agents, scoring, provider/Dynamics adapters, cache, rate limits, audit |
| `packages/mission-orchestrator` | Orchestrates intelligence tasks through Phase 10 engine |
| `apps/temporal-worker` | Durable execution worker (wiring kept minimal in this phase) |

## Domain Model

See `@projectx/domain/src/intelligence`:

- `ICPProfile` — hard filters, soft criteria, scoring weights, thresholds.
- `Account` — lifecycle: `DISCOVERED → ENRICHED → QUALIFIED`, with `DUPLICATE` and `DISQUALIFIED` exits.
- `Contact` — lifecycle: `DISCOVERED → ENRICHED → VALIDATED`, with `SUPPRESSED` exit.
- `Lead` — lifecycle: `PENDING → EVALUATING → QUALIFIED / NOT_QUALIFIED / NEEDS_REVIEW`, with approve/reject from review.
- `ResearchEvidence` — immutable evidence value object with source, reliability tier, confidence breakdown, provenance chain, and contradictions.

## Pipeline

```
ICP Profile
    ↓
Account Discovery (IResearchProvider.discoverAccounts)
    ↓
Dynamics Duplicate Check (IDynamicsIntelligenceAdapter.findDuplicateAccount)
    ↓
Company Intelligence (IResearchProvider.getCompanyIntelligence)
    ↓
Contact Discovery + Enrichment (discoverContacts / enrichContact)
    ↓
Signal Detection (IResearchProvider.detectSignals)
    ↓
ICP Match + Evidence Confidence
    ↓
Lead Scoring + Qualification
    ↓
Qualified Lead (auditable evidence references attached)
```

## Agent Topology

Agent contracts are registered from `@projectx/intelligence/src/services/agent-registry.ts`. Capabilities include:

- `execute-research-pipeline` — end-to-end research orchestrator task.
- `discover-accounts`, `company-intelligence`, `discover-contacts`, `enrich-contact`, `detect-buying-signals`, `evaluate-icp-match`, `score-lead`.

The runtime agent is `IntelligenceAgentExecutor` (`packages/intelligence/src/services/agent-executor.ts`), which routes a mission task to `ResearchEngine.run`.

## Evidence and Provenance

`ResearchEvidence` requires:

- `claimType` and `normalizedValue`
- `source` and `reliabilityTier` (`OFFICIAL`, `PREMIUM_PROVIDER`, `PUBLIC_RECORD`, `DERIVED`, `USER_PROVIDED`)
- `confidence` + `confidenceBreakdown` (`sourceReliability`, `extractionConfidence`, `corroboration`)
- `provenance[]` — chain of agent/tool steps
- `contradictions[]` — conflicting evidence and resolution

No raw HTML or screenshots enter the domain model.

## Lead Scoring

`LeadScorer` composes:

- `icpMatch` — deterministic hard-filter pass/fail plus weighted soft criteria
- `signalScore` — recency-weighted, confidence-weighted buying/intent signals
- `intentScore` — derived from `icpMatch` and `signalScore`
- `evidenceConfidence` — freshness-weighted evidence confidence

Final score = weighted sum using `ICPProfile.scoringWeights`. Thresholds define `QUALIFIED`, `NEEDS_REVIEW`, and `NOT_QUALIFIED`.

## Tool / Provider Boundaries

| Port | File |
| --- | --- |
| `IResearchProvider` | `packages/intelligence/src/ports/research-provider.interface.ts` |
| `IProviderRegistry` | `packages/intelligence/src/ports/provider-registry.interface.ts` |
| `IRateLimitStore` | `packages/intelligence/src/ports/rate-limit.interface.ts` |
| `IIntelligenceCache` | `packages/intelligence/src/ports/intelligence-cache.interface.ts` |
| `IIntelligenceAuditLog` | `packages/intelligence/src/ports/intelligence-audit-log.interface.ts` |
| `IDynamicsIntelligenceAdapter` | `packages/intelligence/src/ports/dynamics-intelligence.interface.ts` |

In-memory doubles and stubs live under `packages/intelligence/src/infrastructure`.

## Dynamics 365 Boundary

- Port: `IDynamicsIntelligenceAdapter`
- Adapter: `StubDynamicsIntelligenceAdapter`
- Phase 11 supports read-only lookups and duplicate detection.
- No real HTTP calls, no write-back.

## Memory and Caching

- `IIntelligenceCache` stores provider results keyed by tenant + query hash with TTL.
- Cache hits do not count against rate limits or cost budgets.
- TTL is configurable per provider/query type.

## Security and Tenant Isolation

- Every repository, cache, provider registry, audit log, and Dynamics lookup is keyed by `tenantId`.
- `ensureSameTenant` is applied by the orchestrator engine before every mission operation.
- Provider credentials/configurations are tenant-scoped.

## Failure and Recovery

- Provider failures are retried with exponential back-off up to a configurable limit.
- Rate-limit hits pause until the quota window resets.
- Budget exhaustion blocks the mission for human decision.
- Duplicate accounts/contacts are routed to canonical records.
- Low-confidence or contradictory evidence can trigger `NEEDS_REVIEW`.

## Testing Strategy

- Domain aggregate tests: `packages/domain/src/__tests__/intelligence.spec.ts`
- Research engine tests: `packages/intelligence/src/__tests__/research-engine.spec.ts`
- Mission integration test: `packages/mission-orchestrator/src/__tests__/phase11-integration.spec.ts`
- All tests run with deterministic stubs and in-memory doubles.

## Integration with Phase 10

A Phase 11 mission adds the `execute-research-pipeline` task type. The `MissionExecutionEngine` delegates task execution to `IntelligenceAgentExecutor`, which runs the research pipeline and persists qualified leads. The orchestrator owns pause/resume, approval gates, retries, and compensation.

## ADRs

- `ADR-097` — Intelligence package boundary
- `ADR-098` — Dynamics 365 port + stub
- `ADR-099` — Evidence provenance model
- `ADR-100` — Tenant-isolated intelligence cache
- `ADR-101` — Research provider abstraction
- `ADR-102` — Evidence-backed deterministic lead scoring
- `ADR-103` — Reuse Phase 10 approval boundary
