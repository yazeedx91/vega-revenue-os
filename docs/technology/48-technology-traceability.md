# Technology Traceability

## Traceability Model

```
Requirement → Architectural Requirement → Technology → Component → Contract → Operational Requirement
```

## Example Traces

| Requirement | Architectural Requirement | Technology | Component | Contract | Operational Requirement |
|---|---|---|---|---|---|
| Autonomous revenue missions | Durable mission execution | Temporal | Workflow Engine | Mission Contract | 99.9% durable execution |
| Tenant isolation | Tenant context everywhere | PostgreSQL RLS + Redis key prefix + Service Bus tenantId | Multi-tenancy layer | Event Envelope | Tenant data never leaks |
| LLM provider abstraction | LLM Gateway | Custom TypeScript gateway + Azure OpenAI adapters | AI Execution Plane | AI Execution Contract | Replaceable LLM provider |
| CRM integration without domain leakage | Anti-corruption layer | Dataverse Web API adapter | CRM Integration Service | CRM Sync API | No Dynamics IDs in domain |
| Human approval | Workflow approval gates | Temporal signals + Service Bus | Approval Service | Approval API | Approval SLA / timeout |
| Long-running missions | Workflow durability | Temporal + PostgreSQL persistence | Mission Orchestrator | Mission Contract | RPO 1h / RTO 4h |
| Observability | End-to-end tracing | OpenTelemetry + Azure Monitor | All services | Correlation ID | p95 latency targets |
| AI cost governance | Cost attribution | Token/cost tracking in LLM Gateway | AI Cost Governance | AI Execution Contract | Budget enforcement |

## Traceability Maintenance

- Update traceability matrix when technology choices change.
- Link Proposed ADRs to requirements and components.
- Ensure every technology maps to at least one architectural requirement.
- Flag orphan technologies or unmet requirements.
