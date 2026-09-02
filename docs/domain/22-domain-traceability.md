# Domain Traceability

## Traceability Matrix

The following matrix maps major business requirements to domain concepts.

| Business Requirement | Business Capability | Bounded Context | Domain Concept | Type | Command | Domain Event |
|---|---|---|---|---|---|---|
| Define a revenue objective | Mission & Strategy | Revenue Mission Management | Mission | Aggregate Root | CreateMission | MissionCreated |
| Configure target market | Market Strategy | ICP & Market Strategy | ICPProfile | Aggregate Root | ConfigureICP | ICPProfileCreated |
| Discover target companies | Market Discovery | Company Intelligence | Company | Aggregate Root | DiscoverCompanies | CompanyDiscovered |
| Research a company | Company Intelligence | Company Intelligence | CompanyResearch | Entity | ResearchCompany | CompanyResearched |
| Detect buying signals | Buying Signal Detection | Buying Signal Intelligence | BuyingSignal | Aggregate Root | DetectBuyingSignals | BuyingSignalDetected |
| Identify decision-makers | Decision-Maker Mapping | Contact Intelligence | Contact | Aggregate Root | IdentifyContacts | ContactIdentified |
| Score an opportunity | Opportunity Scoring | Opportunity Management | OpportunityScore | Entity | ScoreOpportunity | OpportunityScored |
| Qualify a lead | Lead Qualification | Lead & Qualification Management | Lead | Aggregate Root | QualifyLead | LeadQualified |
| Generate personalized outreach | Personalization | Outreach & Communication | OutreachCampaign | Aggregate Root | GenerateOutreach | OutreachGenerated |
| Send outreach | Outreach | Outreach & Communication | Message | Entity | SendOutreach | OutreachSent |
| Handle prospect reply | Conversation Management | Conversation Management | Conversation | Aggregate Root | HandleReply | ProspectReplied |
| Qualify conversation | Lead Qualification | Conversation Management | Conversation | Aggregate Root | QualifyConversation | ConversationQualified |
| Schedule meeting | Meeting Scheduling | Meeting & Scheduling | Meeting | Aggregate Root | BookMeeting | MeetingBooked |
| Create CRM opportunity | CRM Management | CRM Synchronization | CRMConnection | Aggregate Root | SyncToCRM | CRMOpportunityCreated |
| Prepare sales brief | Sales Handoff | Opportunity Management | Opportunity | Aggregate Root | PrepareBrief | SalesBriefGenerated |
| Record outcome | Outcome Tracking | Revenue Mission Management | Outcome | Entity | RecordOutcome | OutcomeRecorded |
| Evaluate performance | Analytics | Revenue Analytics | Report | Read Model | N/A | Consumes events |
| Improve strategy | Strategy Improvement | Revenue Mission Management / ICP | MissionPlan, ICPProfile | Entity/Root | UpdateMissionPlan | MissionPlanUpdated |
| Enforce AI safety | AI Governance | AI Governance & Policy | Policy | Aggregate Root | DefinePolicy | PolicyDefined |
| Manage agent execution | Agent Management | AI Agent Management | AgentExecution | Aggregate Root | ExecuteTask | AgentExecutionStarted |
| Track agent outcomes | Agent Management | AI Agent Management | AgentOutcome | Value Object | CompleteExecution | AgentExecutionCompleted |
| Manage consent | Compliance | Compliance & Consent | Consent | Aggregate Root | RecordConsent | ConsentGranted |
| Enforce suppression | Compliance | Compliance & Consent | SuppressionRecord | Entity | AddSuppression | SuppressionCreated |
| Audit decisions | Audit | Audit & Governance | AuditRecord | Aggregate Root | RecordAuditEvent | AuditRecordCreated |
| Bill usage | Billing | Billing & Subscription | UsageRecord | Entity | RecordUsage | UsageRecorded |

## Traceability Gaps

- Revenue attribution is a read-model concern; no single aggregate owns it.
- Personalization quality is evaluated by a domain service or read model, not an aggregate.
- Learning and model improvement are driven from events and read models, not a domain command.

## Domain-to-Business Mapping

| Business Term | Domain Concept |
|---|---|
| Mission | Mission aggregate root |
| ICP | ICPProfile aggregate root |
| Account / Company | Company aggregate root |
| Contact | Contact aggregate root |
| Lead | Lead aggregate root |
| Opportunity | Opportunity aggregate root |
| Meeting | Meeting aggregate root |
| Conversation | Conversation aggregate root |
| Agent | Agent aggregate root |
| Agent run | AgentExecution aggregate root |
| Approval | Approval entity in AI Governance |
| Policy | Policy aggregate root |
| Consent | Consent aggregate root |
| Audit entry | AuditRecord aggregate root |

## Cross-Reference to Business Architecture

- `/docs/business/09-business-processes.md` processes A–R map to commands and events in this matrix.
- `/docs/business/08-business-capabilities.md` capabilities map to bounded contexts.
- `/docs/business/14-business-rules.md` rules map to domain invariants and policies.
