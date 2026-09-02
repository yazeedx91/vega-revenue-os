# Aggregates

## Aggregate Catalog

### Tenant Aggregate

- **Aggregate Root**: Tenant
- **Owned Entities**: Organization, Workspace (only if lifecycle is tightly coupled)
- **Owned Value Objects**: TenantId, TenantStatus, TenantConfiguration
- **Invariants**:
  - A tenant always has a valid status.
  - Tenant configuration cannot violate platform-level constraints.
- **Consistency Boundary**: Tenant and its directly owned configuration
- **Commands**: CreateTenant, ActivateTenant, SuspendTenant, OffboardTenant
- **Domain Events**: TenantCreated, TenantActivated, TenantSuspended, TenantOffboarded

### User Aggregate

- **Aggregate Root**: User
- **Owned Entities**: TenantMembership, Role assignment references
- **Owned Value Objects**: UserId, EmailAddress, PersonName
- **Invariants**:
  - A user must have at least one authentication identity.
  - Tenant membership roles are scoped to a tenant.
- **Consistency Boundary**: User and memberships
- **Commands**: InviteUser, AssignRole, RevokePermission
- **Domain Events**: UserInvited, UserRoleChanged

### Mission Aggregate

- **Aggregate Root**: Mission
- **Owned Entities**: MissionPlan, MissionObjective, Outcome (reference)
- **Owned Value Objects**: MissionId, MissionStatus, DateRange, AutonomyLevel
- **Invariants**:
  - A mission must have a valid objective and ICP reference.
  - State transitions must follow the allowed state machine.
  - A completed/cancelled/archived mission cannot execute new tasks.
- **Consistency Boundary**: Mission and its plan/objectives
- **Commands**: CreateMission, ApproveMission, StartMission, PauseMission, ResumeMission, CancelMission, CompleteMission, FailMission
- **Domain Events**: MissionCreated, MissionApproved, MissionStarted, MissionPaused, MissionCompleted, MissionFailed, MissionCancelled, MissionArchived

### ICPProfile Aggregate

- **Aggregate Root**: ICPProfile
- **Owned Entities**: ICPFilter, ICPSignal
- **Owned Value Objects**: ICPProfileId, Geography, Industry, RevenueRange, EmployeeRange
- **Invariants**:
  - An ICP must have at least one hard filter or signal rule.
  - Signal rules must define source and confidence requirements.
- **Consistency Boundary**: ICPProfile and its rules
- **Commands**: ConfigureICP, UpdateICP, ActivateICP, DeactivateICP
- **Domain Events**: ICPProfileCreated, ICPProfileUpdated, ICProfileActivated

### Company Aggregate

- **Aggregate Root**: Company
- **Owned Entities**: CompanyResearch, Evidence, ExternalReference
- **Owned Value Objects**: CompanyId, CompanyName, DomainName, Geography, Industry
- **Invariants**:
  - A company belongs to exactly one tenant.
  - Evidence must cite a source.
- **Consistency Boundary**: Company and its research/evidence
- **Commands**: DiscoverCompany, ResearchCompany, EnrichCompany
- **Domain Events**: CompanyDiscovered, CompanyResearched, CompanyEnriched

### Contact Aggregate

- **Aggregate Root**: Contact
- **Owned Entities**: DecisionMakerProfile, ContactEnrichment
- **Owned Value Objects**: ContactId, PersonName, EmailAddress, PhoneNumber
- **Invariants**:
  - A contact belongs to exactly one tenant and optionally one company.
  - Decision-maker classification requires a role.
- **Consistency Boundary**: Contact and its profiles
- **Commands**: IdentifyContact, EnrichContact, MapDecisionMaker
- **Domain Events**: ContactIdentified, ContactEnriched, DecisionMakerMapped

### Lead Aggregate

- **Aggregate Root**: Lead
- **Owned Entities**: Qualification
- **Owned Value Objects**: LeadId, LeadStatus, QualificationStatus, ConfidenceScore
- **Invariants**:
  - A lead cannot be both qualified and disqualified simultaneously.
  - Disqualification must include a reason.
  - A suppressed contact cannot produce an active lead.
- **Consistency Boundary**: Lead and its qualification history
- **Commands**: CreateLead, QualifyLead, DisqualifyLead, ConvertLead
- **Domain Events**: LeadCreated, LeadQualified, LeadDisqualified, LeadConverted

### BuyingSignal Aggregate

- **Aggregate Root**: BuyingSignal
- **Owned Entities**: SignalSource, SignalEvaluation
- **Owned Value Objects**: SignalId, SignalType, SignalStrength, ConfidenceScore, SourceCitation
- **Invariants**:
  - A signal must have a source and date.
  - Signal strength and confidence must be within valid ranges.
- **Consistency Boundary**: Signal and its evaluations
- **Commands**: DetectSignal, EvaluateSignal, ExpireSignal
- **Domain Events**: BuyingSignalDetected, BuyingSignalExpired, BuyingSignalConfirmed

### Opportunity Aggregate

- **Aggregate Root**: Opportunity
- **Owned Entities**: OpportunityStage, OpportunityScore
- **Owned Value Objects**: OpportunityId, OpportunityStatus, Money, Percentage
- **Invariants**:
  - An opportunity must belong to a valid tenant.
  - Stage transitions follow the defined sales process.
  - Won/Lost opportunities are terminal.
- **Consistency Boundary**: Opportunity and stage/score history
- **Commands**: CreateOpportunity, QualifyOpportunity, WinOpportunity, LoseOpportunity, CloseOpportunity
- **Domain Events**: OpportunityCreated, OpportunityQualified, OpportunityWon, OpportunityLost, OpportunityClosed

### OutreachCampaign Aggregate

- **Aggregate Root**: OutreachCampaign
- **Owned Entities**: Message, Template
- **Owned Value Objects**: CampaignId, MessageId, ChannelType, MessageStatus
- **Invariants**:
  - Messages cannot be sent to suppressed contacts.
  - High-risk messages require recorded approval.
- **Consistency Boundary**: Campaign and its messages
- **Commands**: CreateCampaign, GenerateMessage, ApproveMessage, SendMessage
- **Domain Events**: CampaignCreated, OutreachGenerated, OutreachApproved, OutreachSent, OutreachFailed

### Conversation Aggregate

- **Aggregate Root**: Conversation
- **Owned Entities**: Message (within thread)
- **Owned Value Objects**: ConversationId, ConversationStatus
- **Invariants**:
  - Messages are ordered within a conversation.
  - A closed conversation cannot receive new messages without explicit reopening.
- **Consistency Boundary**: Conversation and its messages
- **Commands**: StartConversation, HandleReply, QualifyConversation, CloseConversation
- **Domain Events**: ConversationStarted, ProspectReplied, ConversationQualified, ConversationClosed

### Meeting Aggregate

- **Aggregate Root**: Meeting
- **Owned Entities**: MeetingSlot
- **Owned Value Objects**: MeetingId, MeetingStatus, TimeRange
- **Invariants**:
  - A meeting must have at least one prospect and one customer attendee.
  - Completed/cancelled meetings cannot return to scheduled without a correction process.
- **Consistency Boundary**: Meeting and its slots
- **Commands**: RequestMeeting, BookMeeting, RescheduleMeeting, CancelMeeting, CompleteMeeting, MarkNoShow
- **Domain Events**: MeetingRequested, MeetingBooked, MeetingRescheduled, MeetingCancelled, MeetingCompleted, MeetingNoShow

### Agent Aggregate

- **Aggregate Root**: Agent
- **Owned Entities**: AgentRole, AgentCapability, AgentVersion
- **Owned Value Objects**: AgentId, AgentStatus
- **Invariants**:
  - An agent must have at least one capability.
  - Agent versions are immutable once published.
- **Consistency Boundary**: Agent and its capabilities/versions
- **Commands**: CreateAgent, RegisterCapability, PublishVersion, ActivateAgent, DeactivateAgent
- **Domain Events**: AgentCreated, CapabilityRegistered, AgentVersionPublished, AgentActivated

### AgentExecution Aggregate

- **Aggregate Root**: AgentExecution
- **Owned Entities**: AgentTask, AgentOutcome, AgentFailure
- **Owned Value Objects**: ExecutionId, ExecutionStatus, ConfidenceScore
- **Invariants**:
  - State transitions follow the execution state machine.
  - An execution must reference a valid agent and a tenant.
  - Awaiting approval requires an associated approval record.
- **Consistency Boundary**: Execution, its tasks, outcomes, and failures
- **Commands**: CreateExecution, StartExecution, CompleteExecution, FailExecution, CancelExecution, RollbackExecution
- **Domain Events**: AgentExecutionStarted, AgentExecutionCompleted, AgentExecutionFailed, AgentExecutionAwaitingApproval, AgentExecutionCancelled, AgentExecutionRolledBack

### Policy Aggregate

- **Aggregate Root**: Policy
- **Owned Entities**: ApprovalRule, AutonomyPolicy
- **Owned Value Objects**: PolicyId, AutonomyLevel
- **Invariants**:
  - A policy cannot permit actions beyond tenant-level constraints.
  - Approval rules must define who can approve.
- **Consistency Boundary**: Policy and its rules
- **Commands**: DefinePolicy, SetAutonomyLevel, AddApprovalRule, RemoveApprovalRule
- **Domain Events**: PolicyDefined, AutonomyLevelChanged, ApprovalRuleAdded

### Consent Aggregate

- **Aggregate Root**: Consent
- **Owned Entities**: SuppressionRecord
- **Owned Value Objects**: ConsentId, ConsentStatus, EmailAddress, DomainName
- **Invariants**:
  - A contact cannot have conflicting active consent states.
  - Opt-out immediately prevents outreach.
- **Consistency Boundary**: Consent and suppression records for a contact
- **Commands**: RecordConsent, WithdrawConsent, AddSuppression, RemoveSuppression
- **Domain Events**: ConsentGranted, ConsentWithdrawn, SuppressionCreated, SuppressionRemoved

### CRMConnection Aggregate

- **Aggregate Root**: CRMConnection
- **Owned Entities**: SyncMapping, CRMRecordReference
- **Owned Value Objects**: ConnectionId, CRMEntityType, SyncStatus
- **Invariants**:
  - A connection belongs to one tenant and one CRM provider.
  - Mappings must reference valid domain concepts.
- **Consistency Boundary**: Connection and its mappings
- **Commands**: CreateCRMConnection, AddSyncMapping, SyncToCRM, SyncFromCRM
- **Domain Events**: CRMConnectionCreated, CRMOpportunityCreated, CRMOpportunityUpdated, CRMSyncFailed

### Subscription Aggregate

- **Aggregate Root**: Subscription
- **Owned Entities**: UsageRecord
- **Owned Value Objects**: SubscriptionId, CreditBalance
- **Invariants**:
  - Usage records are append-only.
  - Credits cannot go below zero unless explicitly allowed.
- **Consistency Boundary**: Subscription and its recent usage
- **Commands**: CreateSubscription, RecordUsage, ConsumeCredits
- **Domain Events**: SubscriptionCreated, UsageRecorded, CreditsConsumed

### Audit Aggregate

- **Aggregate Root**: AuditRecord
- **Owned Entities**: DecisionLogEntry
- **Owned Value Objects**: AuditRecordId, ActorId, ActionType, Timestamp
- **Invariants**:
  - Audit records are immutable and append-only.
  - Every record has an actor, action, and timestamp.
- **Consistency Boundary**: Individual audit record append
- **Commands**: RecordAuditEvent, RecordDecision
- **Domain Events**: AuditRecordCreated

## Aggregate Design Rules

- Aggregates are small and focused on a single consistency boundary.
- Cross-aggregate communication uses domain events, commands, or read models.
- No aggregate directly modifies another aggregate's state.
- Tenant identity is a value object on every tenant-scoped aggregate but the Tenant aggregate itself is independent.
