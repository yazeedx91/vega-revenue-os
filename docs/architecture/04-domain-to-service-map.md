# Domain-to-Service Map

## Mapping Table

| Bounded Context | Domain Concepts | Runtime Service | Data Ownership | APIs | Events | Scaling Model |
|---|---|---|---|---|---|---|
| Tenant & Organization Management | Tenant, Organization, Workspace | Tenant Management Service | Tenant aggregate | Tenant Admin API | TenantCreated, TenantSuspended, TenantOffboarded | Horizontal read; careful write |
| User & Identity Management | User, Role, Permission, Membership | User Management Service | User aggregate | User/Role API | UserInvited, UserRoleChanged | Horizontal |
| Revenue Mission Management | Mission, MissionPlan, Outcome | Mission Management Service | Mission aggregate | Mission API | MissionCreated, MissionApproved, MissionStarted, MissionCompleted | Horizontal |
| ICP & Market Strategy | ICPProfile, ICPFilter, ICPMatch | ICP & Intelligence Service | ICPProfile aggregate | ICP API | ICPProfileCreated, ICPMatched | Horizontal; research heavy |
| Company Intelligence | Company, Research, Evidence | ICP & Intelligence Service | Company aggregate | Company API | CompanyDiscovered, CompanyResearched | Horizontal |
| Contact Intelligence | Contact, DecisionMakerProfile | ICP & Intelligence Service | Contact aggregate | Contact API | ContactIdentified, ContactEnriched | Horizontal |
| Lead & Qualification Management | Lead, Qualification | Mission Management / Lead Service | Lead aggregate | Lead API | LeadCreated, LeadQualified, LeadDisqualified | Horizontal |
| Buying Signal Intelligence | BuyingSignal | ICP & Intelligence Service | BuyingSignal aggregate | Signals API | BuyingSignalDetected, BuyingSignalExpired | Horizontal |
| Opportunity Management | Opportunity, Stage, Score | Mission Management / Opportunity Service | Opportunity aggregate | Opportunity API | OpportunityCreated, OpportunityWon, OpportunityLost | Horizontal |
| Outreach & Communication | Campaign, Message, Template | Outreach Service | OutreachCampaign aggregate | Outreach API | OutreachGenerated, OutreachSent | Horizontal; high volume |
| Conversation Management | Conversation, Message | Conversation Service | Conversation aggregate | Conversation API | ProspectReplied, ConversationClosed | Horizontal |
| Meeting & Scheduling | Meeting, MeetingSlot | Meeting Service | Meeting aggregate | Meeting API | MeetingBooked, MeetingCancelled | Horizontal |
| CRM Synchronization | CRMConnection, SyncMapping | CRM Integration Service | CRMConnection aggregate | CRM API | CRMOpportunityCreated, CRMSyncFailed | Worker-scaled; rate limited |
| Revenue Analytics | Report, KPI, Metric | Revenue Analytics Service | Read projections | Analytics API | Consumes all events | Horizontal read |
| AI Agent Management | Agent, AgentExecution, AgentTask | Agent Management Service + AI Execution Workers | Agent, AgentExecution aggregates | Agent API, Execution API | AgentExecutionStarted, AgentExecutionCompleted | Worker-scaled |
| Knowledge Management | KnowledgeItem, Memory | Knowledge & Memory Service | KnowledgeItem aggregate | Knowledge API | KnowledgeItemCreated | Horizontal read |
| AI Governance & Policy | Policy, AutonomyPolicy, Approval | AI Governance Service | Policy aggregate | Policy API, Approval API | PolicyDefined, ApprovalRequested, ApprovalGranted | Horizontal |
| Billing & Subscription | Subscription, UsageRecord | Billing Service | Subscription aggregate | Billing API | UsageRecorded | Horizontal |
| Compliance & Consent | Consent, SuppressionRecord | AI Governance Service / Compliance module | Consent aggregate | Consent API | ConsentWithdrawn, SuppressionCreated | Horizontal |
| Audit & Governance | AuditRecord | Audit Service | AuditRecord aggregate | Audit API | AuditRecordCreated | Append-only; horizontal ingest |

## Domain Concept → Runtime Component → Storage

| Domain Concept | Runtime Component | Storage Category |
|---|---|---|
| Mission | Mission Management Service | Operational DB |
| Company | ICP & Intelligence Service | Operational DB + Vector Store for embeddings |
| Contact | ICP & Intelligence Service | Operational DB |
| Lead | Lead Service | Operational DB |
| Opportunity | Mission/Opportunity Service | Operational DB |
| Conversation | Conversation Service | Operational DB |
| Message | Outreach/Conversation Service | Operational DB + Object Storage for large content |
| Meeting | Meeting Service | Operational DB |
| Agent | Agent Management Service | Operational DB |
| AgentExecution | AI Execution Workers | Operational DB + Event log |
| Policy | AI Governance Service | Operational DB |
| Approval | AI Governance Service | Operational DB |
| Consent | Compliance module | Operational DB |
| KnowledgeItem | Knowledge & Memory Service | Vector Store + Object Storage |
| AuditRecord | Audit Service | Audit Store |
| UsageRecord | Billing Service | Operational DB + Analytics Store |
| Report | Revenue Analytics Service | Analytics Store |

## Cross-Service Communication

| From Service | To Service | Pattern | Example |
|---|---|---|---|
| Mission Management | AI Execution Workers | Command via Event Bus | ExecuteTask |
| AI Execution Workers | Mission Management | Domain Event | AgentExecutionCompleted |
| Outreach Service | AI Execution Workers | Command | GenerateMessage |
| Conversation Service | AI Execution Workers | Command | HandleReply |
| ICP & Intelligence | Mission Management | Domain Event | CompanyDiscovered |
| CRM Integration | Mission Management / Opportunity | Domain Event | CRMOpportunityCreated |
| AI Governance | AI Execution Workers | Read Model / Policy Query | PolicyEvaluationResult |
| All services | Audit Service | Domain Event | AuditRecordCreated |
| All services | Revenue Analytics | Domain Event | Various |

## Service Ownership Rules

- Each aggregate is owned by exactly one service.
- Services do not update another service's aggregates directly.
- Cross-service updates happen via commands and events.
- Read models can be duplicated across services for performance, but writes are owned by one service.
