# Domain Invariants

## Invariant Catalog

### Multi-Tenancy Invariants

| Invariant | Statement | Owner | Enforcement |
|---|---|---|---|
| INV-T1 | Every tenant-scoped aggregate belongs to exactly one tenant | All aggregates | Aggregate constructor, command validation |
| INV-T2 | A user of one tenant cannot access or modify data of another tenant | User & Identity / Infrastructure | Authorization layer, query scoping |
| INV-T3 | Tenant-scoped domain events include the tenant identity | All aggregates | Event factory |

### Mission Invariants

| Invariant | Statement | Owner | Enforcement |
|---|---|---|---|
| INV-M1 | A mission must have a measurable objective and a referenced ICP | Mission Aggregate | CreateMission command |
| INV-M2 | State transitions must follow the allowed state machine | Mission Aggregate | Mission state methods |
| INV-M3 | A completed/cancelled/archived mission cannot execute new tasks | Mission Aggregate | Task execution command |
| INV-M4 | Mission-level success criteria must be defined before approval | Mission Aggregate | ApproveMission command |
| INV-M5 | A mission cannot be approved if its ICP is inactive | Mission Aggregate | ApproveMission command |

### Lead & Qualification Invariants

| Invariant | Statement | Owner | Enforcement |
|---|---|---|---|
| INV-L1 | A lead cannot be both qualified and disqualified simultaneously | Lead Aggregate | State methods |
| INV-L2 | Disqualification must include a reason | Lead Aggregate | DisqualifyLead command |
| INV-L3 | A suppressed contact cannot produce an active lead | Lead Aggregate / Compliance | Lead creation command |
| INV-L4 | A lead can only be converted if it is qualified | Lead Aggregate | ConvertLead command |
| INV-L5 | Qualification must cite evidence | Qualification entity | QualifyLead command |

### Outreach & Conversation Invariants

| Invariant | Statement | Owner | Enforcement |
|---|---|---|---|
| INV-O1 | Outreach cannot be sent to a suppressed or opted-out contact | OutreachCampaign Aggregate | SendOutreach command |
| INV-O2 | High-risk outreach must have a recorded approval before sending | OutreachCampaign Aggregate | ApproveOutreach command |
| INV-O3 | A conversation message must belong to exactly one conversation | Conversation Aggregate | AddMessage command |
| INV-O4 | A closed conversation cannot receive new messages without explicit reopening | Conversation Aggregate | HandleReply command |
| INV-O5 | Messages are ordered by timestamp within a conversation | Conversation Aggregate | Message append |

### Meeting Invariants

| Invariant | Statement | Owner | Enforcement |
|---|---|---|---|
| INV-ME1 | A meeting must have at least one prospect and one customer attendee | Meeting Aggregate | BookMeeting command |
| INV-ME2 | A completed/cancelled meeting cannot return to scheduled without a correction process | Meeting Aggregate | State methods |
| INV-ME3 | A meeting cannot be booked with an unqualified prospect unless policy explicitly allows | Meeting Aggregate | BookMeeting command |
| INV-ME4 | Meeting slots must not overlap for the same required attendee | Meeting Aggregate / Availability service | Slot selection |

### Opportunity Invariants

| Invariant | Statement | Owner | Enforcement |
|---|---|---|---|
| INV-OP1 | An opportunity must belong to a valid tenant | Opportunity Aggregate | CreateOpportunity command |
| INV-OP2 | Stage transitions must follow the defined sales process | Opportunity Aggregate | State methods |
| INV-OP3 | Won/Lost opportunities are terminal | Opportunity Aggregate | Win/Lose methods |
| INV-OP4 | An opportunity should be associated with a decision-maker or influencer | Opportunity Aggregate | CreateOpportunity command (soft invariant) |

### AI Agent Invariants

| Invariant | Statement | Owner | Enforcement |
|---|---|---|---|
| INV-A1 | An agent must have at least one capability | Agent Aggregate | CreateAgent command |
| INV-A2 | Agent versions are immutable once published | Agent Aggregate | PublishVersion command |
| INV-A3 | Agent execution state transitions must follow the execution state machine | AgentExecution Aggregate | Execution methods |
| INV-A4 | An execution awaiting approval must have an associated approval record | AgentExecution Aggregate | AwaitApproval method |
| INV-A5 | An agent cannot act beyond its registered capabilities | AI Agent Management | ExecuteTask command |

### Governance & Policy Invariants

| Invariant | Statement | Owner | Enforcement |
|---|---|---|---|
| INV-G1 | Autonomy level cannot exceed tenant-configured maximum | AI Governance & Policy | SetAutonomyLevel command |
| INV-G2 | Destructive actions always require approval regardless of autonomy level | Policy Evaluation | AutonomyDecisionService |
| INV-G3 | A policy cannot permit actions beyond platform-level constraints | AI Governance & Policy | DefinePolicy command |
| INV-G4 | Approval rules must define eligible approvers | Policy Aggregate | AddApprovalRule command |

### Compliance Invariants

| Invariant | Statement | Owner | Enforcement |
|---|---|---|---|
| INV-C1 | A contact cannot have conflicting active consent states | Consent Aggregate | Consent commands |
| INV-C2 | Opt-out immediately prevents outreach | Compliance & Consent / Outreach | SuppressionCheckService |
| INV-C3 | Audit records are immutable and append-only | Audit & Governance | RecordAuditEvent command |
| INV-C4 | Suppression records must include a reason | Consent Aggregate | AddSuppression command |

### CRM Synchronization Invariants

| Invariant | Statement | Owner | Enforcement |
|---|---|---|---|
| INV-CRM1 | A CRM connection belongs to exactly one tenant and provider | CRMConnection Aggregate | CreateCRMConnection command |
| INV-CRM2 | Sync mappings must reference valid domain concepts | CRMConnection Aggregate | AddSyncMapping command |
| INV-CRM3 | Duplicate CRM opportunities must not be created for the same domain opportunity | CRM Synchronization | SyncToCRM command |

## Invariant Enforcement Principles

- Invariants within an aggregate are enforced by the aggregate root.
- Cross-aggregate invariants are enforced by domain services, policies, or through eventual consistency and compensating actions.
- Invariants involving external systems are verified before commands are accepted; failures produce domain events and compensations.
