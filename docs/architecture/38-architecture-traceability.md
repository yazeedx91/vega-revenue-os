# Architecture Traceability

## Traceability Model

Business Requirement → Business Capability → Bounded Context → Runtime Service → API/Event → Data Ownership

## Example Traces

| Business Requirement | Business Capability | Bounded Context | Runtime Service | API/Event | Data Ownership |
|---|---|---|---|---|---|
| Discover target companies | Market Intelligence | Company Intelligence | ICP & Intelligence Service | CompanyDiscovered event | Company aggregate |
| Qualify prospects | Lead Qualification | Lead & Qualification Management | Lead Service | LeadQualified event | Lead aggregate |
| Generate personalized outreach | Outreach Execution | Outreach & Communication | Outreach Service | OutreachGenerated event | OutreachCampaign aggregate |
| Manage conversations | Conversation Management | Conversation Management | Conversation Service | ProspectReplied event | Conversation aggregate |
| Schedule meetings | Meeting Scheduling | Meeting & Scheduling | Meeting Service | MeetingBooked event | Meeting aggregate |
| Sync opportunities | CRM Integration | CRM Synchronization | CRM Integration Service | CRMOpportunityCreated event | CRMConnection aggregate |
| Execute autonomous missions | Mission Execution | Revenue Mission Management | Mission Management Service + Workflow Engine | MissionStarted, MissionCompleted events | Mission aggregate |
| Enforce human approval | Human Oversight | AI Governance & Policy | AI Governance Service | ApprovalRequested, ApprovalGranted events | Approval aggregate |

## Domain Concept → Runtime Component → Storage

| Domain Concept | Runtime Component | Storage |
|---|---|---|
| Mission | Mission Management Service | Operational DB |
| Company | ICP & Intelligence Service | Operational DB + Vector Store |
| Contact | ICP & Intelligence Service | Operational DB |
| Lead | Lead Service | Operational DB |
| Opportunity | Mission/Opportunity Service | Operational DB |
| Conversation | Conversation Service | Operational DB |
| Meeting | Meeting Service | Operational DB |
| Agent | Agent Management Service | Operational DB |
| AgentExecution | AI Execution Workers | Operational DB + Event Store |
| Policy | AI Governance Service | Operational DB |
| Approval | AI Governance Service | Operational DB |
| KnowledgeItem | Knowledge & Memory Service | Vector Store + Object Storage |
| AuditRecord | Audit Service | Audit Store |
| Report | Revenue Analytics Service | Analytics Store |

## Gap Analysis

| Gap | Mitigation |
|---|---|
| Product Constitution missing | Tracked as dependency; architecture aligned with approved ADRs, business, and domain docs |
| LLM provider selection | Proposed ADR pending |
| Event infrastructure selection | Proposed ADR pending |
| Specific numerical DR targets | Marked PROPOSED; require business validation |
| Physical database schemas | Out of scope for Phase 04 |
| API contract details | Out of scope for Phase 04; addressed in Phase 05 |

## Traceability Maintenance

- Traceability matrix updated when business/domain/architecture changes.
- New capabilities must map to a bounded context and runtime service.
- New services must justify which bounded contexts they own.
