# AI Architecture Traceability

## Traceability Model

Business Capability → AI Capability → Agent Capability → Runtime Component → Tool → Policy → Outcome

## Example Traces

| Business Capability | AI Capability | Agent | Runtime Component | Tool | Policy | Outcome |
|---|---|---|---|---|---|---|
| Discover target companies | Research and evidence gathering | Research Agent | AI Execution Plane / Research Agent | SearchWeb, EnrichCompany | Allowed research sources, tenant scope | Company evidence |
| Evaluate ICP match | ICP scoring and explainability | ICP Qualification Agent | AI Execution Plane / ICP Agent | QueryKnowledge | ICP thresholds, autonomy | ICP match record |
| Qualify leads | Lead qualification reasoning | Lead Qualification Agent | AI Execution Plane / Lead Agent | QueryEvidence | Qualification rules, approval | LeadQualified event |
| Generate outreach | Message strategy and drafting | Outreach Strategist + Writer | AI Execution Plane / Outreach Agents | DraftOutreach, SendEmail | Brand, compliance, autonomy | OutreachSent event |
| Handle replies | Intent detection and response | Conversation Agent | AI Execution Plane / Conversation Agent | GetReply, SendEmail | Conversation policy, opt-out | ProspectReplied event |
| Schedule meetings | Meeting coordination | Meeting Agent | AI Execution Plane / Meeting Agent | QueryAvailability, BookMeeting | Autonomy, calendar policy | MeetingBooked event |
| Update CRM | CRM data synchronization | CRM Agent | AI Execution Plane / CRM Agent | PrepareCRMUpdate, SyncCRM | Data ownership, autonomy | CRMOpportunityCreated event |

## Domain Event Trace

| Domain Event | AI Trigger | Agent | Action | Result | Evaluation |
|---|---|---|---|---|---|
| MissionApproved | Start planning | Mission Orchestrator | Create plan | Plan created | Plan validity |
| CompanyDiscovered | Enrich company | Research Agent | Research company | Evidence created | Evidence quality |
| ICPMatched | Score ICP | ICP Agent | Evaluate match | Match record | Accuracy |
| LeadQualified | Qualify lead | Lead Agent | Qualify | Lead status | Precision/recall |
| OutreachGenerated | Generate message | Outreach Writer | Draft message | Draft | Claim support |
| ProspectReplied | Handle reply | Conversation Agent | Parse intent/reply | Reply sent | Conversation quality |
| MeetingBooked | Book meeting | Meeting Agent | Calendar action | Meeting | Conversion |
| OpportunityCreated | Sync CRM | CRM Agent | CRM update | CRM record | Accuracy |

## Traceability Maintenance

- Traceability matrix updated when business capabilities, domain model, or AI architecture changes.
- New AI capabilities must map to a runtime component, policy, and outcome.
- New agents must justify which business capabilities they support.
- Gaps flagged in completion report.
