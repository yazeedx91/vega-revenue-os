# Architecture Constraints

## Constraints from ADRs

| Constraint | Source | Implication |
|---|---|---|
| Domain logic must not depend on infrastructure | ADR-001 Clean Architecture | Ports/adapters for all external concerns |
| Provider-neutral core domain | ADR-004 Provider-neutral domain model | Dynamics 365 isolated behind adapter |
| Event-driven cross-context communication | ADR-005 Event-Driven Architecture | Asynchronous patterns dominate |
| Multi-tenancy with strong isolation | ADR-054 Multi-Tenancy Model | Tenant context everywhere |
| Tenant-scoped roles and permissions | ADR-056 Tenant-Scoped Roles and Permissions | RBAC/ABAC at every layer |
| Agent orchestration with separation of concerns | ADR-025 Agent Orchestration Architecture | Control plane separate from execution plane |
| Human-in-the-loop approval mechanism | ADR-030 Human-in-the-Loop and Approval | Approval workflow in autonomy architecture |

## Technical Constraints

| Constraint | Implication |
|---|---|
| No production deployment in Phase 04 | Architecture only; no infrastructure provisioning |
| No application code in Phase 04 | Specifications only |
| No database schemas | Logical data architecture only |
| No UI implementation | API-first contracts only |
| No credentials/secrets in docs | Secrets managed by secrets manager in implementation |
| No implementation-specific vendor lock-in | Abstracted adapters and gateways |

## Business Constraints

| Constraint | Implication |
|---|---|
| Initial specialization Microsoft Dynamics 365 ERP sales | First CRM adapter targets Dynamics 365 |
| Autonomy levels 0-5 must be supported | Architectural controls at every level |
| Compliance and audit requirements | Immutable audit and policy enforcement |
| Prospects are external parties | Email, calendar, meeting provider integrations required |

## Assumed Constraints

- Public cloud deployment.
- Containerized workloads.
- Managed databases, cache, and message broker.
- OAuth2/OIDC identity provider.

These constraints inform Phase 05 technology and implementation choices.
