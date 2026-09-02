# Entities

## Entity Catalog

| Entity | Definition | Business Purpose | Identity | Bounded Context |
|---|---|---|---|---|
| Tenant | Customer organization using the platform | First-class isolation and configuration boundary | TenantId | Tenant & Organization Management |
| Organization | Organizational unit within a tenant | Hierarchical structure | OrganizationId | Tenant & Organization Management |
| Workspace | Scoped working environment | Tenant subdivision | WorkspaceId | Tenant & Organization Management |
| User | Human user of the platform | Authentication and role assignment | UserId | User & Identity Management |
| Role | Named set of permissions | Authorization grouping | RoleId | User & Identity Management |
| Permission | Action that may be performed | Fine-grained access control | PermissionId | User & Identity Management |
| TenantMembership | Membership of a user in a tenant | Tenant-scoped roles | MembershipId | User & Identity Management |
| Mission | Scoped revenue objective assigned to the AI | Core revenue execution unit | MissionId | Revenue Mission Management |
| MissionPlan | Planned sequence of tasks for a mission | Execution plan | MissionPlanId | Revenue Mission Management |
| MissionObjective | Measurable goal of a mission | Success definition | MissionObjectiveId | Revenue Mission Management |
| TaskDefinition | Domain definition of a mission task | Reusable task specification | TaskDefinitionId | Revenue Mission Management |
| Outcome | Measured result of a mission | Attribution and learning | OutcomeId | Revenue Mission Management |
| ICPProfile | Configurable ideal customer profile | Target definition | ICPProfileId | ICP & Market Strategy |
| ICPFilter | Criterion for matching companies/contacts | Matching rule | ICPFilterId | ICP & Market Strategy |
| ICPSignal | Signal definition in an ICP | Signal rule | ICPSignalId | ICP & Market Strategy |
| ICPMatch | Evaluation result of a company/contact against an ICP | Matching evidence | ICPMatchId | ICP & Market Strategy |
| Company | Target organization | Core prospect entity | CompanyId | Company Intelligence |
| CompanyResearch | Research record for a company | Enrichment evidence | ResearchId | Company Intelligence |
| Evidence | Source-backed fact | Trustworthy data point | EvidenceId | Company Intelligence |
| ExternalReference | Reference to an external record | Source traceability | ReferenceId | Company Intelligence |
| Contact | Person associated with a company | Engagement target | ContactId | Contact Intelligence |
| DecisionMakerProfile | Role and influence data for a contact | Target prioritization | ProfileId | Contact Intelligence |
| ContactEnrichment | Enrichment data for a contact | Data quality | EnrichmentId | Contact Intelligence |
| Lead | Candidate for engagement | Qualification lifecycle | LeadId | Lead & Qualification Management |
| Qualification | Evaluation of a lead against criteria | Lead status | QualificationId | Lead & Qualification Management |
| BuyingSignal | Evidence of potential need | Scored intelligence | SignalId | Buying Signal Intelligence |
| SignalSource | Origin of a buying signal | Source traceability | SourceId | Buying Signal Intelligence |
| Opportunity | Potential deal | Sales pipeline object | OpportunityId | Opportunity Management |
| OpportunityStage | Stage in opportunity lifecycle | Sales process | StageId | Opportunity Management |
| OutreachCampaign | Coordinated outreach effort | Message coordination | CampaignId | Outreach & Communication |
| Message | Single communication | Conversation unit | MessageId | Outreach & Communication |
| Template | Reusable message structure | Consistency and governance | TemplateId | Outreach & Communication |
| Conversation | Thread of messages with a prospect | Dialogue state | ConversationId | Conversation Management |
| Meeting | Scheduled synchronous interaction | Sales handoff | MeetingId | Meeting & Scheduling |
| MeetingSlot | Proposed or available time slot | Scheduling | SlotId | Meeting & Scheduling |
| Agent | Configured AI actor | AI identity and capability | AgentId | AI Agent Management |
| AgentRole | Role an agent can fulfill | Capability grouping | AgentRoleId | AI Agent Management |
| AgentCapability | Specific skill or tool use | Capability definition | CapabilityId | AI Agent Management |
| AgentVersion | Version of an agent configuration | Versioning | VersionId | AI Agent Management |
| AgentExecution | Single run of an agent task | Operational trace | ExecutionId | AI Agent Management |
| AgentTask | Task assigned to an agent by a mission | Work unit | AgentTaskId | AI Agent Management |
| AgentOutcome | Result of an agent execution | Outcome trace | OutcomeId | AI Agent Management |
| AgentFailure | Failure record for an execution | Failure traceability | FailureId | AI Agent Management |
| KnowledgeItem | Stored fact or pattern | Learned knowledge | KnowledgeItemId | Knowledge Management |
| Memory | Short or long-term stored context | Context retrieval | MemoryId | Knowledge Management |
| Policy | Rule governing AI behavior | Safety and compliance | PolicyId | AI Governance & Policy |
| Approval | Human authorization of an action | Oversight | ApprovalId | AI Governance & Policy |
| Consent | Record of communication consent | Compliance | ConsentId | Compliance & Consent |
| SuppressionRecord | Record preventing outreach | Compliance | SuppressionId | Compliance & Consent |
| CRMConnection | Connection to an external CRM | Integration configuration | ConnectionId | CRM Synchronization |
| SyncMapping | Mapping between domain and CRM entities | Synchronization rule | MappingId | CRM Synchronization |
| AuditRecord | Immutable record of a domain action | Accountability | AuditRecordId | Audit & Governance |
| UsageRecord | Billable usage event | Commercial metering | UsageRecordId | Billing & Subscription |
| Subscription | Tenant subscription status | Commercial relationship | SubscriptionId | Billing & Subscription |

## Lifecycle Notes

- **Tenant**: Draft → Active → Suspended → Offboarded
- **Mission**: Draft → Approved → Scheduled → Planning → Executing → Paused/Blocked/AwaitingApproval → Completed/Failed/Cancelled → Archived
- **Lead**: Discovered → Researching → Qualified → Contacted → Engaged → Converted/Disqualified/Suppressed
- **Opportunity**: Identified → Qualified → MeetingBooked → SalesHandoff → Open → Won/Lost/Closed
- **Conversation**: Initiated → Active → Qualification → MeetingRequested → MeetingBooked → Handoff → Closed
- **Meeting**: Requested → Proposed → Scheduled → Rescheduled → Completed/Cancelled/NoShow
- **AgentExecution**: Created → Queued → Running → Waiting/AwaitingApproval → Completed/Failed/Cancelled/RolledBack
