# Bounded Contexts

## Context Definitions

### 1. Tenant & Organization Management

- **Purpose**: Own the tenant lifecycle and organization-level configuration
- **Scope**: Tenant aggregate root, organization structure, workspace settings
- **Owned concepts**: Tenant, Organization, Workspace
- **Responsibilities**: Tenant onboarding, configuration, lifecycle states
- **Inbound dependencies**: Identity Management
- **Outbound dependencies**: AI Governance, Billing, Compliance
- **Upstream contexts**: Identity Management
- **Downstream contexts**: Mission Management, AI Governance, Billing
- **Published language**: TenantId, OrganizationId, WorkspaceId, TenantStatus
- **Integration pattern**: Commands and domain events
- **Data ownership**: Tenant data is isolated per tenant
- **Consistency**: Strong consistency within Tenant aggregate
- **Domain events**: TenantCreated, TenantActivated, TenantSuspended, TenantOffboarded
- **Commands**: CreateTenant, ActivateTenant, SuspendTenant, OffboardTenant
- **Queries**: GetTenant, GetTenantConfiguration

### 2. User & Identity Management

- **Purpose**: Manage users and tenant-scoped roles/permissions
- **Scope**: User, Role, Permission, membership
- **Owned concepts**: User, Role, Permission, TenantMembership
- **Responsibilities**: User lifecycle, role assignment, permission enforcement
- **Inbound dependencies**: External identity provider
- **Outbound dependencies**: Tenant & Organization Management
- **Upstream contexts**: External identity provider
- **Downstream contexts**: All tenant-scoped contexts
- **Published language**: UserId, RoleId, Permission, TenantId
- **Integration pattern**: Read model / claims
- **Data ownership**: User aggregate
- **Consistency**: Strong within User aggregate; eventual for role propagation
- **Domain events**: UserInvited, UserRoleChanged, PermissionGranted
- **Commands**: InviteUser, AssignRole, RevokePermission
- **Queries**: GetUserPermissions, GetTenantMembers

### 3. Revenue Mission Management

- **Purpose**: Define, plan, execute, and monitor revenue missions
- **Scope**: Mission, MissionPlan, Task, outcome
- **Owned concepts**: Mission, MissionPlan, MissionObjective, TaskDefinition, Outcome
- **Responsibilities**: Mission lifecycle, success criteria, business orchestration
- **Inbound dependencies**: AI Governance, ICP & Market Strategy
- **Outbound dependencies**: AI Agent Management, Company Intelligence, Lead Management, Opportunity Management
- **Upstream contexts**: AI Governance, Tenant Management
- **Downstream contexts**: AI Agent Management, Lead Management, Opportunity Management, Meeting Management
- **Published language**: MissionId, MissionStatus, MissionObjective, TaskId
- **Integration pattern**: Domain events and commands
- **Data ownership**: Mission aggregate
- **Consistency**: Strong within Mission aggregate; eventual cross-context
- **Domain events**: MissionCreated, MissionApproved, MissionStarted, MissionPaused, MissionCompleted, MissionFailed, MissionCancelled
- **Commands**: CreateMission, ApproveMission, StartMission, PauseMission, ResumeMission, CancelMission, CompleteMission
- **Queries**: GetMission, ListMissions, GetMissionStatus

### 4. ICP & Market Strategy

- **Purpose**: Own target market definition and matching
- **Scope**: ICPProfile, filters, signals, matching rules
- **Owned concepts**: ICPProfile, ICPFilter, ICPSignal, ICPMatch
- **Responsibilities**: ICP configuration, matching, scoring
- **Inbound dependencies**: Tenant Management
- **Outbound dependencies**: Company Intelligence, Lead Management
- **Upstream contexts**: Tenant Management
- **Downstream contexts**: Company Intelligence, Lead Management
- **Published language**: ICPProfileId, ICPMatchScore, FilterType, SignalType
- **Integration pattern**: Domain events and read models
- **Data ownership**: ICPProfile aggregate
- **Consistency**: Strong within ICPProfile aggregate
- **Domain events**: ICPProfileCreated, ICPProfileUpdated, ICPMatched
- **Commands**: ConfigureICP, UpdateICP, EvaluateCompanyAgainstICP
- **Queries**: GetICPProfile, GetICPMatch

### 5. Company Intelligence

- **Purpose**: Research and enrich target organizations
- **Scope**: Company, research, evidence, signals
- **Owned concepts**: Company, CompanyResearch, Evidence, ExternalReference
- **Responsibilities**: Company discovery, research, enrichment, signal collection
- **Inbound dependencies**: ICP & Market Strategy
- **Outbound dependencies**: Buying Signal Intelligence, Contact Intelligence, Lead Management
- **Upstream contexts**: ICP & Market Strategy
- **Downstream contexts**: Buying Signal Intelligence, Contact Intelligence, Lead Management
- **Published language**: CompanyId, CompanyStatus, ResearchId
- **Integration pattern**: Domain events
- **Data ownership**: Company aggregate
- **Consistency**: Strong within Company aggregate
- **Domain events**: CompanyDiscovered, CompanyResearched, CompanyEnriched
- **Commands**: DiscoverCompanies, ResearchCompany, EnrichCompany
- **Queries**: GetCompany, SearchCompanies

### 6. Contact Intelligence

- **Purpose**: Enrich and manage people associated with companies
- **Scope**: Contact, decision-maker mapping, enrichment
- **Owned concepts**: Contact, DecisionMakerProfile, ContactEnrichment
- **Responsibilities**: Contact discovery, enrichment, role classification
- **Inbound dependencies**: Company Intelligence
- **Outbound dependencies**: Lead Management
- **Upstream contexts**: Company Intelligence
- **Downstream contexts**: Lead Management
- **Published language**: ContactId, DecisionMakerRole, EnrichmentStatus
- **Integration pattern**: Domain events
- **Data ownership**: Contact aggregate
- **Consistency**: Strong within Contact aggregate
- **Domain events**: ContactIdentified, ContactEnriched, DecisionMakerMapped
- **Commands**: IdentifyContacts, EnrichContact, MapDecisionMaker
- **Queries**: GetContact, FindDecisionMakers

### 7. Lead & Qualification Management

- **Purpose**: Own lead lifecycle and qualification decisions
- **Scope**: Lead, qualification status, evidence
- **Owned concepts**: Lead, Qualification, DisqualificationReason
- **Responsibilities**: Lead creation, qualification, disqualification, lifecycle
- **Inbound dependencies**: Company Intelligence, Contact Intelligence, ICP & Market Strategy
- **Outbound dependencies**: Outreach & Communication, Opportunity Management
- **Upstream contexts**: ICP & Market Strategy
- **Downstream contexts**: Outreach & Communication, Opportunity Management
- **Published language**: LeadId, LeadStatus, QualificationStatus
- **Integration pattern**: Domain events
- **Data ownership**: Lead aggregate
- **Consistency**: Strong within Lead aggregate
- **Domain events**: LeadCreated, LeadQualified, LeadDisqualified, LeadConverted
- **Commands**: CreateLead, QualifyLead, DisqualifyLead
- **Queries**: GetLead, ListQualifiedLeads

### 8. Buying Signal Intelligence

- **Purpose**: Detect and evaluate buying signals
- **Scope**: BuyingSignal, signal sources, scoring
- **Owned concepts**: BuyingSignal, SignalSource, SignalEvaluation
- **Responsibilities**: Signal detection, evaluation, confidence scoring
- **Inbound dependencies**: Company Intelligence, external research
- **Outbound dependencies**: Lead & Qualification Management
- **Upstream contexts**: Company Intelligence, external research
- **Downstream contexts**: Lead & Qualification Management
- **Published language**: SignalId, SignalType, SignalStrength, SignalConfidence
- **Integration pattern**: Domain events
- **Data ownership**: BuyingSignal aggregate
- **Consistency**: Strong within BuyingSignal aggregate
- **Domain events**: BuyingSignalDetected, BuyingSignalExpired, BuyingSignalConfirmed
- **Commands**: DetectBuyingSignals, EvaluateSignal, ExpireSignal
- **Queries**: GetSignalsForCompany, GetSignalConfidence

### 9. Opportunity Management

- **Purpose**: Own potential deals from qualification to close
- **Scope**: Opportunity, stage, score, ownership
- **Owned concepts**: Opportunity, OpportunityStage, OpportunityScore
- **Responsibilities**: Opportunity lifecycle, scoring, handoff
- **Inbound dependencies**: Lead & Qualification Management, Meeting & Scheduling
- **Outbound dependencies**: CRM Synchronization, Revenue Analytics
- **Upstream contexts**: Lead & Qualification Management, Meeting & Scheduling
- **Downstream contexts**: CRM Synchronization, Revenue Analytics
- **Published language**: OpportunityId, OpportunityStatus, OpportunityStage
- **Integration pattern**: Domain events
- **Data ownership**: Opportunity aggregate
- **Consistency**: Strong within Opportunity aggregate
- **Domain events**: OpportunityCreated, OpportunityQualified, OpportunityWon, OpportunityLost
- **Commands**: CreateOpportunity, QualifyOpportunity, WinOpportunity, LoseOpportunity
- **Queries**: GetOpportunity, ListOpportunities

### 10. Outreach & Communication

- **Purpose**: Manage personalized outbound communication
- **Scope**: OutreachCampaign, Message, template, channel
- **Owned concepts**: OutreachCampaign, Message, Template, Channel
- **Responsibilities**: Draft, approve, send, and track outreach
- **Inbound dependencies**: Lead & Qualification Management, AI Agent Management
- **Outbound dependencies**: Conversation Management, external email/LinkedIn providers
- **Upstream contexts**: Lead & Qualification Management
- **Downstream contexts**: Conversation Management, external providers
- **Published language**: CampaignId, MessageId, ChannelType, MessageStatus
- **Integration pattern**: Domain events and ACL with external providers
- **Data ownership**: OutreachCampaign aggregate
- **Consistency**: Strong within OutreachCampaign aggregate
- **Domain events**: OutreachGenerated, OutreachApproved, OutreachSent
- **Commands**: GenerateOutreach, ApproveOutreach, SendOutreach
- **Queries**: GetMessage, GetCampaignStatus

### 11. Conversation Management

- **Purpose**: Handle prospect replies and maintain dialogue state
- **Scope**: Conversation, Message thread, state
- **Owned concepts**: Conversation, Message, ConversationState
- **Responsibilities**: Reply interpretation, state transitions, qualification handoff
- **Inbound dependencies**: Outreach & Communication
- **Outbound dependencies**: Lead & Qualification Management, Meeting & Scheduling
- **Upstream contexts**: Outreach & Communication
- **Downstream contexts**: Lead & Qualification Management, Meeting & Scheduling
- **Published language**: ConversationId, MessageId, ConversationStatus
- **Integration pattern**: Domain events
- **Data ownership**: Conversation aggregate
- **Consistency**: Strong within Conversation aggregate
- **Domain events**: ProspectReplied, ConversationQualified, ConversationClosed
- **Commands**: HandleReply, QualifyConversation, CloseConversation
- **Queries**: GetConversation, ListConversations

### 12. Meeting & Scheduling

- **Purpose**: Schedule and track meetings between customers and prospects
- **Scope**: Meeting, MeetingSlot, calendar integration
- **Owned concepts**: Meeting, MeetingSlot, AvailabilityWindow
- **Responsibilities**: Meeting scheduling, rescheduling, cancellation, completion
- **Inbound dependencies**: Conversation Management, Opportunity Management
- **Outbound dependencies**: CRM Synchronization, external calendar providers
- **Upstream contexts**: Conversation Management
- **Downstream contexts**: CRM Synchronization, external calendars
- **Published language**: MeetingId, MeetingStatus, MeetingSlot
- **Integration pattern**: Domain events and ACL with calendar providers
- **Data ownership**: Meeting aggregate
- **Consistency**: Strong within Meeting aggregate
- **Domain events**: MeetingRequested, MeetingBooked, MeetingRescheduled, MeetingCompleted, MeetingCancelled
- **Commands**: RequestMeeting, BookMeeting, RescheduleMeeting, CancelMeeting, CompleteMeeting
- **Queries**: GetMeeting, ListMeetings

### 13. CRM Synchronization

- **Purpose**: Translate and sync domain objects with external CRMs
- **Scope**: CRMConnection, sync mappings, anti-corruption layer
- **Owned concepts**: CRMConnection, SyncMapping, CRMRecordReference
- **Responsibilities**: Bi-directional sync, deduplication, conflict resolution
- **Inbound dependencies**: Opportunity Management, Meeting & Scheduling
- **Outbound dependencies**: External CRM (Dynamics 365 first)
- **Upstream contexts**: Opportunity Management, Meeting & Scheduling
- **Downstream contexts**: External CRM via ACL
- **Published language**: CRMConnectionId, CRMEntityType, SyncStatus
- **Integration pattern**: Anti-Corruption Layer, integration events
- **Data ownership**: CRMConnection aggregate
- **Consistency**: Strong within CRMConnection aggregate; eventual sync with external CRM
- **Domain events**: CRMOpportunityCreated, CRMOpportunityUpdated, CRMSyncFailed
- **Commands**: CreateCRMConnection, SyncToCRM, MapCRMEntity
- **Queries**: GetCRMConnection, GetSyncStatus

### 14. Revenue Analytics

- **Purpose**: Provide read models and KPIs over revenue data
- **Scope**: Read models, dashboards, reports
- **Owned concepts**: KPI, Report, Metric
- **Responsibilities**: Compute and present analytics without owning source aggregates
- **Inbound dependencies**: All operational contexts
- **Outbound dependencies**: None (read-only)
- **Upstream contexts**: All operational contexts
- **Downstream contexts**: None
- **Published language**: KPI definitions, metric values
- **Integration pattern**: Domain event projection
- **Data ownership**: Read-only projections
- **Consistency**: Eventually consistent
- **Domain events**: Consumes events; emits none authoritative
- **Commands**: None
- **Queries**: GetKPIs, GetMissionPerformance, GetPipelineReport

### 15. AI Agent Management

- **Purpose**: Own agent lifecycle and operational execution
- **Scope**: Agent, AgentRole, AgentCapability, AgentExecution, AgentTask
- **Owned concepts**: Agent, AgentVersion, AgentCapability, AgentExecution, AgentTask, AgentOutcome, AgentFailure
- **Responsibilities**: Agent identity, versioning, execution, outcome tracking
- **Inbound dependencies**: Mission Management, AI Governance
- **Outbound dependencies**: AI Governance, external LLM providers (via infrastructure)
- **Upstream contexts**: AI Governance
- **Downstream contexts**: Mission Management (events), external providers via ACL
- **Published language**: AgentId, AgentExecutionId, AgentTaskId, ExecutionStatus
- **Integration pattern**: Domain events and commands
- **Data ownership**: Agent and AgentExecution aggregates
- **Consistency**: Strong within Agent and AgentExecution aggregates
- **Domain events**: AgentExecutionStarted, AgentExecutionCompleted, AgentExecutionFailed, AgentExecutionAwaitingApproval
- **Commands**: CreateAgent, RegisterCapability, ExecuteTask, CancelExecution
- **Queries**: GetAgent, GetExecution

### 16. Knowledge Management

- **Purpose**: Maintain learned patterns, templates, and facts
- **Scope**: KnowledgeItem, KnowledgeSource, memory
- **Owned concepts**: KnowledgeItem, KnowledgeSource, Memory
- **Responsibilities**: Store and retrieve knowledge for agents
- **Inbound dependencies**: AI Agent Management
- **Outbound dependencies**: AI Agent Management
- **Upstream contexts**: AI Agent Management
- **Downstream contexts**: AI Agent Management
- **Published language**: KnowledgeItemId, SourceType, MemoryId
- **Integration pattern**: Query and event projection
- **Data ownership**: KnowledgeItem aggregate
- **Consistency**: Eventual consistency for projections
- **Domain events**: KnowledgeItemCreated, MemoryUpdated
- **Commands**: StoreKnowledge, UpdateMemory
- **Queries**: RetrieveKnowledge, SearchMemory

### 17. AI Governance & Policy

- **Purpose**: Define and enforce policies for safe, compliant AI behavior
- **Scope**: Policy, AutonomyPolicy, ApprovalPolicy, risk controls
- **Owned concepts**: Policy, AutonomyPolicy, ApprovalPolicy, RiskControl
- **Responsibilities**: Policy definition, autonomy levels, approval rules, risk controls
- **Inbound dependencies**: Tenant Management
- **Outbound dependencies**: AI Agent Management, Mission Management
- **Upstream contexts**: Tenant Management
- **Downstream contexts**: AI Agent Management, Mission Management
- **Published language**: PolicyId, AutonomyLevel, ApprovalRule
- **Integration pattern**: Commands and read models
- **Data ownership**: Policy aggregate
- **Consistency**: Strong within Policy aggregate
- **Domain events**: PolicyDefined, AutonomyLevelChanged, ApprovalRequired
- **Commands**: DefinePolicy, SetAutonomyLevel, RequireApproval
- **Queries**: GetPolicy, EvaluatePolicy

### 18. Billing & Subscription

- **Purpose**: Track usage and support commercial billing
- **Scope**: Subscription, usage credits, metering
- **Owned concepts**: Subscription, UsageRecord, CreditBalance
- **Responsibilities**: Metering, credit tracking, subscription status
- **Inbound dependencies**: Mission Management, AI Agent Management
- **Outbound dependencies**: External billing system
- **Upstream contexts**: Mission Management, AI Agent Management
- **Downstream contexts**: External billing system
- **Published language**: SubscriptionId, CreditBalance, UsageType
- **Integration pattern**: Domain events and integration events
- **Data ownership**: Subscription aggregate
- **Consistency**: Strong within Subscription aggregate
- **Domain events**: UsageRecorded, CreditsConsumed, SubscriptionRenewed
- **Commands**: RecordUsage, ConsumeCredits
- **Queries**: GetCreditBalance, GetUsageReport

### 19. Compliance & Consent

- **Purpose**: Manage consent, opt-out, suppression, and privacy rules
- **Scope**: Consent, SuppressionRecord, privacy policy
- **Owned concepts**: Consent, SuppressionRecord, PrivacyRule
- **Responsibilities**: Consent tracking, opt-out enforcement, suppression
- **Inbound dependencies**: Tenant Management, Outreach & Communication
- **Outbound dependencies**: Outreach & Communication, Lead Management
- **Upstream contexts**: Tenant Management
- **Downstream contexts**: Outreach & Communication, Lead Management
- **Published language**: ConsentId, SuppressionReason, ConsentStatus
- **Integration pattern**: Commands and read models
- **Data ownership**: Consent aggregate
- **Consistency**: Strong within Consent aggregate
- **Domain events**: ConsentGranted, ConsentWithdrawn, SuppressionCreated
- **Commands**: RecordConsent, RecordOptOut, AddSuppression
- **Queries**: CheckConsent, IsSuppressed

### 20. Audit & Governance

- **Purpose**: Immutable record of domain decisions and actions
- **Scope**: AuditRecord, decision log
- **Owned concepts**: AuditRecord, DecisionLogEntry
- **Responsibilities**: Append-only audit, non-repudiation, compliance reporting
- **Inbound dependencies**: All contexts
- **Outbound dependencies**: Revenue Analytics
- **Upstream contexts**: All contexts
- **Downstream contexts**: Revenue Analytics
- **Published language**: AuditRecordId, ActorId, ActionType
- **Integration pattern**: Domain events and audit log append
- **Data ownership**: AuditRecord aggregate
- **Consistency**: Append-only, immutable
- **Domain events**: AuditRecordCreated
- **Commands**: RecordAuditEvent
- **Queries**: GetAuditTrail, GetDecisionLog
