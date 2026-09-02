# Core Domain

## Core Domain Statement

**Autonomous Revenue Execution**: the system plans, executes, monitors, and improves revenue-generating missions on behalf of a tenant, with appropriate human oversight and learning.

## Core Domain Capabilities

- Mission definition and lifecycle management
- ICP-driven target discovery and research
- Lead qualification and opportunity scoring
- Personalized, policy-governed outreach
- Conversation handling and qualification
- Meeting scheduling and sales handoff
- Outcome attribution and continuous learning

## Core Domain Concepts

| Concept | Classification | Why Core? |
|---|---|---|
| Mission | Aggregate Root | Defines the revenue work the AI employee performs |
| MissionPlan | Entity / Value Object | Represents the planned sequence of tasks |
| Lead | Aggregate Root | Represents a revenue candidate and its lifecycle |
| Opportunity | Aggregate Root | Represents a potential deal |
| Conversation | Aggregate Root | Captures AI-prospect dialogue and state |
| OutreachCampaign | Entity | Coordinates personalized outreach at scale |
| ICPProfile | Aggregate Root | Encapsulates the tenant's target definition |
| BuyingSignal | Entity / Value Object | Evidence that drives qualification |
| AgentExecution | Aggregate Root | Operational record of an AI action |
| AgentDecision | Value Object / Domain Event | Captures a recorded AI choice |
| Decision | Entity | Human or AI authorization/choice, auditable |

## Supporting Domain Concepts

| Concept | Context | Why Supporting? |
|---|---|---|
| Tenant | Tenant Management | Required but not the competitive differentiator |
| User / Role / Permission | Identity Management | Standard enterprise concerns |
| Company / Contact | Company/Contact Intelligence | Important but data-rich rather than differentiating |
| Meeting | Meeting & Scheduling | Necessary coordination domain |
| CRM Synchronization | Integration | Adapter concern |
| Compliance / Consent | Compliance | Regulatory enabler |
| Billing / Subscription | Billing | Commercial enabler |

## Generic Domain Concepts

- Authentication (OAuth2/OIDC)
- Audit logging
- Notifications
- File storage
- Search indexing

## Infrastructure Concerns

- LLM provider clients
- Message broker clients
- Database persistence
- REST/GraphQL transport
- Object storage clients
- Observability agents

## Why This Classification

Concentrating engineering effort on Mission, Lead, Opportunity, Conversation, ICP, and AgentExecution preserves the platform's differentiation. Supporting domains can use standard patterns or third-party services. Infrastructure concerns are abstracted behind ports and adapters as defined in ADR-001 and ADR-004.
