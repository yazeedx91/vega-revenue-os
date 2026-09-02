# Domain Events

## Event Catalog

### Mission Lifecycle Events

| Event | Meaning | Producer | Consumers | Payload |
|---|---|---|---|---|
| MissionCreated | A new mission was defined | Revenue Mission Management | AI Agent Management, Billing | MissionId, TenantId, objective, ICPProfileId |
| MissionApproved | A mission was approved | Revenue Mission Management | AI Agent Management, Audit | MissionId, approver, timestamp |
| MissionStarted | Mission execution began | Revenue Mission Management | AI Agent Management, Analytics | MissionId, startedAt |
| MissionPaused | Mission execution paused | Revenue Mission Management | AI Agent Management | MissionId, reason |
| MissionResumed | Mission execution resumed | Revenue Mission Management | AI Agent Management | MissionId |
| MissionCompleted | Mission achieved objectives | Revenue Mission Management | Analytics, Billing | MissionId, outcome |
| MissionFailed | Mission did not achieve objectives | Revenue Mission Management | Analytics, Audit | MissionId, reason |
| MissionCancelled | Mission stopped by human | Revenue Mission Management | AI Agent Management, Billing | MissionId, reason |
| MissionArchived | Mission retained for learning | Revenue Mission Management | Analytics | MissionId |
| MissionPlanUpdated | Mission plan changed | Revenue Mission Management | AI Agent Management | MissionId, plan |

### ICP Events

| Event | Meaning | Producer | Consumers | Payload |
|---|---|---|---|---|
| ICPProfileCreated | New ICP created | ICP & Market Strategy | Mission Management, Company Intelligence | ICPProfileId, TenantId |
| ICPProfileUpdated | ICP rules changed | ICP & Market Strategy | Company Intelligence | ICPProfileId |
| ICProfileActivated | ICP enabled for use | ICP & Market Strategy | Mission Management | ICPProfileId |
| ICPMatched | Company/contact scored against ICP | ICP & Market Strategy / Company Intelligence | Lead Management | TargetId, ICPProfileId, score |

### Company & Contact Events

| Event | Meaning | Producer | Consumers | Payload |
|---|---|---|---|---|
| CompanyDiscovered | Company found matching ICP | Company Intelligence | Lead Management, Buying Signal Intelligence | CompanyId, TenantId, source |
| CompanyResearched | Research completed for company | Company Intelligence | Lead Management | CompanyId, research summary |
| CompanyEnriched | Additional data added | Company Intelligence | Lead Management | CompanyId, evidence |
| ContactIdentified | Contact found for company | Contact Intelligence | Lead Management | ContactId, CompanyId |
| ContactEnriched | Contact data added | Contact Intelligence | Lead Management | ContactId |
| DecisionMakerMapped | Contact classified as decision-maker | Contact Intelligence | Lead Management | ContactId, role |

### Lead & Qualification Events

| Event | Meaning | Producer | Consumers | Payload |
|---|---|---|---|---|
| LeadCreated | Lead created | Lead & Qualification Management | Outreach & Communication | LeadId, CompanyId, ContactId |
| LeadQualified | Lead meets criteria | Lead & Qualification Management | Outreach & Communication | LeadId, score, reason |
| LeadDisqualified | Lead removed | Lead & Qualification Management | Analytics | LeadId, reason |
| LeadConverted | Lead became opportunity | Lead & Qualification Management | Opportunity Management | LeadId, OpportunityId |

### Buying Signal Events

| Event | Meaning | Producer | Consumers | Payload |
|---|---|---|---|---|
| BuyingSignalDetected | New signal found | Buying Signal Intelligence | Lead Management | SignalId, CompanyId, type, strength |
| BuyingSignalExpired | Signal no longer valid | Buying Signal Intelligence | Lead Management | SignalId |
| BuyingSignalConfirmed | Signal validated | Buying Signal Intelligence | Lead Management | SignalId |

### Outreach & Conversation Events

| Event | Meaning | Producer | Consumers | Payload |
|---|---|---|---|---|
| OutreachGenerated | Draft message created | Outreach & Communication | AI Governance | MessageId, LeadId |
| OutreachApproved | Message approved | AI Governance | Outreach & Communication | MessageId, approver |
| OutreachSent | Message sent | Outreach & Communication | Conversation Management | MessageId, channel, timestamp |
| OutreachFailed | Send failed | Outreach & Communication | Mission Management | MessageId, reason |
| ProspectReplied | Prospect responded | Conversation Management | Outreach & Communication | ConversationId, reply |
| ConversationQualified | Conversation meets qualification | Conversation Management | Meeting & Scheduling | ConversationId |
| ConversationClosed | Conversation ended | Conversation Management | Analytics | ConversationId, reason |

### Meeting & Opportunity Events

| Event | Meaning | Producer | Consumers | Payload |
|---|---|---|---|---|
| MeetingRequested | Meeting request created | Meeting & Scheduling | Calendar providers | MeetingId, attendees |
| MeetingBooked | Meeting confirmed | Meeting & Scheduling | Opportunity Management | MeetingId, time, attendees |
| MeetingRescheduled | Meeting time changed | Meeting & Scheduling | Opportunity Management | MeetingId, new time |
| MeetingCompleted | Meeting held | Meeting & Scheduling | Opportunity Management, CRM Sync | MeetingId, outcome |
| MeetingCancelled | Meeting cancelled | Meeting & Scheduling | Opportunity Management | MeetingId, reason |
| MeetingNoShow | Attendee did not attend | Meeting & Scheduling | Follow-up | MeetingId |
| OpportunityCreated | Opportunity created | Opportunity Management | CRM Synchronization | OpportunityId, LeadId |
| OpportunityQualified | Opportunity sales qualified | Opportunity Management | CRM Synchronization | OpportunityId |
| OpportunityWon | Deal closed won | Opportunity Management | CRM Synchronization, Analytics | OpportunityId, value |
| OpportunityLost | Deal closed lost | Opportunity Management | CRM Synchronization, Analytics | OpportunityId, reason |

### AI Agent Events

| Event | Meaning | Producer | Consumers | Payload |
|---|---|---|---|---|
| AgentCreated | New agent registered | AI Agent Management | AI Governance, Mission Management | AgentId, TenantId, role |
| CapabilityRegistered | Capability added | AI Agent Management | AI Governance | AgentId, capability |
| AgentVersionPublished | New agent version released | AI Agent Management | Mission Management | AgentId, version |
| AgentExecutionStarted | Task execution began | AI Agent Management | Mission Management, Billing | ExecutionId, AgentId, task |
| AgentExecutionCompleted | Task execution succeeded | AI Agent Management | Mission Management | ExecutionId, outcome |
| AgentExecutionFailed | Task execution failed | AI Agent Management | Mission Management | ExecutionId, reason |
| AgentExecutionAwaitingApproval | Execution paused for approval | AI Agent Management | AI Governance | ExecutionId, action |
| AgentExecutionCancelled | Execution cancelled | AI Agent Management | Mission Management | ExecutionId |
| AgentExecutionRolledBack | Execution effects reversed | AI Agent Management | Mission Management | ExecutionId |

### Governance & Compliance Events

| Event | Meaning | Producer | Consumers | Payload |
|---|---|---|---|---|
| PolicyDefined | New policy created | AI Governance & Policy | AI Agent Management | PolicyId, type |
| AutonomyLevelChanged | Autonomy configuration changed | AI Governance & Policy | Mission Management, AI Agent Management | TenantId/MissionId, level |
| ApprovalRuleAdded | Approval rule added | AI Governance & Policy | AI Agent Management | PolicyId, rule |
| ApprovalRequested | Human approval needed | AI Agent Management / Mission Management | AI Governance | ApprovalId, action |
| ApprovalGranted | Approval given | AI Governance & Policy | AI Agent Management | ApprovalId, approver |
| ApprovalRejected | Approval denied | AI Governance & Policy | AI Agent Management | ApprovalId, reason |
| ConsentGranted | Consent captured | Compliance & Consent | Outreach & Communication | ConsentId, ContactId |
| ConsentWithdrawn | Opt-out recorded | Compliance & Consent | Outreach & Communication | ContactId |
| SuppressionCreated | Suppression added | Compliance & Consent | Outreach & Communication | SuppressionId, target |

### CRM Synchronization Events

| Event | Meaning | Producer | Consumers | Payload |
|---|---|---|---|---|
| CRMConnectionCreated | CRM integration configured | CRM Synchronization | Opportunity Management | ConnectionId, provider |
| CRMOpportunityCreated | Opportunity synced to CRM | CRM Synchronization | Analytics | OpportunityId, CRM reference |
| CRMOpportunityUpdated | Opportunity updated in CRM | CRM Synchronization | Analytics | OpportunityId |
| CRMSyncFailed | Sync failed | CRM Synchronization | Mission Management, Audit | EntityId, reason |

### Audit Events

| Event | Meaning | Producer | Consumers | Payload |
|---|---|---|---|---|
| AuditRecordCreated | Audit entry appended | Audit & Governance | Revenue Analytics | AuditRecordId, actor, action |

## Event Design Rules

- Domain events represent meaningful business facts, not technical actions.
- Events are immutable and versioned.
- Events include the producer context and tenant identity.
- Consumers must be idempotent.
- Event versioning policy must be documented before implementation.
