# Domain Commands

## Command Catalog

### Mission Management Commands

| Command | Business Meaning | Inputs | Output / Events | Constraints |
|---|---|---|---|---|
| CreateMission | Define a new revenue mission | TenantId, objective, ICPProfileId, timeframe, budget, autonomy level | MissionCreated | Objective must be measurable |
| ApproveMission | Approve a mission for execution | MissionId, approver | MissionApproved | Only authorized user |
| StartMission | Begin mission execution | MissionId | MissionStarted | Status must be Approved or Scheduled |
| PauseMission | Temporarily suspend execution | MissionId, reason | MissionPaused | Cannot pause Archived |
| ResumeMission | Continue paused mission | MissionId | MissionResumed | Status must be Paused |
| CancelMission | Stop mission before completion | MissionId, reason | MissionCancelled | Cannot cancel Archived |
| CompleteMission | Mark mission as successfully completed | MissionId, outcome | MissionCompleted | Success criteria met |
| FailMission | Mark mission as failed | MissionId, reason | MissionFailed | Timeframe expired or blocked |
| ArchiveMission | Retain mission for learning | MissionId | MissionArchived | Must be Completed/Failed/Cancelled |
| UpdateMissionPlan | Modify the plan within constraints | MissionId, plan | MissionPlanUpdated | Cannot modify executing mission without pause |

### ICP Commands

| Command | Business Meaning | Inputs | Output / Events | Constraints |
|---|---|---|---|---|
| ConfigureICP | Create a new ICP | TenantId, name, filters, signals | ICPProfileCreated | At least one rule |
| UpdateICP | Modify an existing ICP | ICPProfileId, changes | ICPProfileUpdated | Must belong to tenant |
| ActivateICP | Enable an ICP for missions | ICPProfileId | ICPProfileActivated | Rules must be valid |
| EvaluateCompanyAgainstICP | Score a company against an ICP | CompanyId, ICPProfileId | ICPMatched | Company belongs to tenant |

### Company & Contact Intelligence Commands

| Command | Business Meaning | Inputs | Output / Events | Constraints |
|---|---|---|---|---|
| DiscoverCompanies | Find companies matching ICP | TenantId, ICPProfileId, sources | CompaniesDiscovered | Sources approved |
| ResearchCompany | Enrich company data | CompanyId, sources | CompanyResearched | Company exists |
| EnrichCompany | Add data to a company | CompanyId, evidence | CompanyEnriched | Evidence cites source |
| IdentifyContacts | Find contacts at a company | CompanyId, roles | ContactsIdentified | Company exists |
| EnrichContact | Add data to a contact | ContactId, data | ContactEnriched | Contact exists |
| MapDecisionMaker | Classify contact as decision-maker | ContactId, role, influence | DecisionMakerMapped | Contact exists |

### Lead & Qualification Commands

| Command | Business Meaning | Inputs | Output / Events | Constraints |
|---|---|---|---|---|
| CreateLead | Create a lead from a contact/company | TenantId, CompanyId, ContactId, source | LeadCreated | Not suppressed |
| QualifyLead | Mark lead as qualified | LeadId, evidence, confidence | LeadQualified | Meets qualification policy |
| DisqualifyLead | Mark lead as disqualified | LeadId, reason | LeadDisqualified | Reason required |
| ConvertLead | Convert lead to opportunity | LeadId | LeadConverted | Lead is qualified |

### Outreach & Conversation Commands

| Command | Business Meaning | Inputs | Output / Events | Constraints |
|---|---|---|---|---|
| GenerateOutreach | Draft a personalized message | LeadId, template, channel | OutreachGenerated | Lead exists and not suppressed |
| ApproveOutreach | Authorize sending a message | MessageId, approver | OutreachApproved | Approval required by policy |
| SendOutreach | Send approved message | MessageId | OutreachSent | Policy allows and not suppressed |
| HandleReply | Process a prospect reply | ConversationId, reply content | ProspectReplied | Conversation exists |
| QualifyConversation | Assess conversation for qualification | ConversationId | ConversationQualified | Enough evidence |
| CloseConversation | Close a conversation | ConversationId, reason | ConversationClosed | Terminal state |

### Meeting & Opportunity Commands

| Command | Business Meaning | Inputs | Output / Events | Constraints |
|---|---|---|---|---|
| RequestMeeting | Initiate meeting scheduling | ConversationId/LeadId, attendees | MeetingRequested | Prospect qualified |
| BookMeeting | Confirm a meeting slot | MeetingId, slot, attendees | MeetingBooked | Availability confirmed |
| RescheduleMeeting | Change meeting time | MeetingId, new slot | MeetingRescheduled | Existing scheduled meeting |
| CancelMeeting | Cancel a meeting | MeetingId, reason | MeetingCancelled | Not completed |
| CompleteMeeting | Record meeting completion | MeetingId, outcome | MeetingCompleted | Meeting was scheduled |
| CreateOpportunity | Create a sales opportunity | LeadId, MeetingId | OpportunityCreated | Lead qualified and meeting exists |
| QualifyOpportunity | Mark opportunity as qualified | OpportunityId | OpportunityQualified | Required evidence |
| WinOpportunity | Mark opportunity as won | OpportunityId, value | OpportunityWon | Terminal state |
| LoseOpportunity | Mark opportunity as lost | OpportunityId, reason | OpportunityLost | Terminal state |

### AI Agent Management Commands

| Command | Business Meaning | Inputs | Output / Events | Constraints |
|---|---|---|---|---|
| CreateAgent | Register a new agent | TenantId, name, role, capabilities | AgentCreated | Valid capabilities |
| RegisterCapability | Add capability to agent | AgentId, capability | CapabilityRegistered | Agent exists |
| PublishAgentVersion | Publish a new agent version | AgentId, configuration | AgentVersionPublished | Version valid |
| ExecuteTask | Instruct agent to perform a task | MissionId, AgentId, task definition | AgentExecutionStarted | Policy allows |
| CompleteExecution | Mark execution as complete | ExecutionId, outcome | AgentExecutionCompleted | Execution running |
| FailExecution | Mark execution as failed | ExecutionId, reason | AgentExecutionFailed | Execution running |
| CancelExecution | Cancel an execution | ExecutionId, reason | AgentExecutionCancelled | Not terminal |

### Governance & Compliance Commands

| Command | Business Meaning | Inputs | Output / Events | Constraints |
|---|---|---|---|---|
| DefinePolicy | Create a policy | TenantId, policy type, rules | PolicyDefined | No conflicts |
| SetAutonomyLevel | Configure autonomy | TenantId/MissionId, level | AutonomyLevelChanged | Within allowed range |
| RequireApproval | Define approval rule | PolicyId, action, approvers | ApprovalRuleAdded | Valid action |
| RecordConsent | Capture consent | ContactId, consent type, source | ConsentGranted | Contact exists |
| WithdrawConsent | Record opt-out | ContactId, source | ConsentWithdrawn | Contact exists |
| AddSuppression | Add to suppression list | ContactId/Domain/CompanyId, reason | SuppressionCreated | Reason required |
| RecordAuditEvent | Append audit record | Actor, action, outcome | AuditRecordCreated | Always allowed |

### CRM Synchronization Commands

| Command | Business Meaning | Inputs | Output / Events | Constraints |
|---|---|---|---|---|
| CreateCRMConnection | Configure CRM integration | TenantId, provider, credentials | CRMConnectionCreated | Valid provider |
| AddSyncMapping | Define domain-to-CRM mapping | ConnectionId, domain entity, CRM entity | SyncMappingAdded | Valid mapping |
| SyncToCRM | Push domain changes to CRM | OpportunityId/MeetingId/CompanyId | CRMOpportunityCreated/Updated | Connection active |

## Command Validation Rules

- Every command must carry the tenant identity.
- Commands must respect aggregate consistency boundaries.
- Cross-aggregate effects must be communicated through domain events.
- Commands requiring human approval must be routed through the approval workflow.
