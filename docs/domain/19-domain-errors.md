# Domain Errors

## Error Categories

Domain errors represent business-level failure conditions. They are not implementation exceptions.

## Business Error Catalog

| Error | Meaning | Owning Context | Typical Cause |
|---|---|---|---|
| InvalidMission | Mission cannot be created or updated | Revenue Mission Management | Missing objective, invalid ICP |
| MissionNotAuthorized | User lacks permission to act on mission | AI Governance / Identity | Insufficient role |
| MissionStateInvalid | Command not allowed in current state | Revenue Mission Management | State machine violation |
| ICPNotConfigured | Required ICP missing or inactive | ICP & Market Strategy | Missing ICP |
| InvalidICPFilter | Filter definition is invalid | ICP & Market Strategy | Syntax or constraint violation |
| CompanyNotFound | Referenced company does not exist | Company Intelligence | Stale reference |
| CompanyAlreadyExists | Duplicate company detected | Company Intelligence | Duplicate detection |
| ContactNotFound | Referenced contact does not exist | Contact Intelligence | Stale reference |
| LeadNotQualified | Lead does not meet qualification criteria | Lead & Qualification Management | Policy not met |
| LeadAlreadyExists | Duplicate lead for contact/company | Lead & Qualification Management | Duplicate detection |
| ContactSuppressed | Contact is suppressed or opted out | Compliance & Consent | Opt-out or suppression |
| OutreachNotPermitted | Outreach violates policy or consent | Outreach & Communication / Compliance | Policy or suppression |
| OutreachApprovalRequired | Human approval needed before sending | AI Governance & Policy | High-risk or low confidence |
| MessageSendFailed | External message delivery failed | Outreach & Communication | Provider error |
| ConversationNotFound | Referenced conversation missing | Conversation Management | Stale reference |
| MeetingUnavailable | No suitable meeting slot found | Meeting & Scheduling | Calendar conflict |
| MeetingNotPermitted | Meeting booking not allowed | Meeting & Scheduling / AI Governance | Prospect not qualified |
| OpportunityAlreadyExists | Duplicate opportunity | Opportunity Management / CRM Synchronization | Duplicate detection |
| OpportunityNotQualified | Opportunity missing required evidence | Opportunity Management | Policy not met |
| AgentNotCapable | Agent lacks required capability | AI Agent Management | Capability mismatch |
| AgentExecutionFailed | Agent task execution failed | AI Agent Management | Runtime or policy failure |
| AutonomyNotPermitted | Action exceeds configured autonomy | AI Governance & Policy | Autonomy level too low |
| ApprovalRequired | Action requires human approval | AI Governance & Policy | Policy rule |
| ApprovalNotFound | Referenced approval missing | AI Governance & Policy | Stale reference |
| PolicyViolation | Action violates a domain policy | AI Governance & Policy | Policy rule |
| TenantAccessDenied | Cross-tenant access attempted | Tenant & Organization / Identity | Authorization failure |
| TenantSuspended | Tenant is suspended | Tenant & Organization Management | Administrative action |
| InsufficientEvidence | Required evidence missing | Lead & Qualification Management / Buying Signal Intelligence | Missing source |
| LowConfidence | Confidence below threshold | Various evaluation contexts | Model or data quality |
| CRMConnectionFailed | CRM integration unavailable | CRM Synchronization | Provider error |
| CRMSyncFailed | Synchronization to CRM failed | CRM Synchronization | Mapping or provider error |
| InvalidStateTransition | Requested state change is not allowed | Various aggregate state machines | Business rule violation |
| DataRetentionViolation | Retention rules would be violated | Compliance & Consent | Retention policy conflict |
| SuppressionConflict | Conflicting suppression records | Compliance & Consent | Data inconsistency |

## Error Handling Patterns

- **Within an aggregate**: Return a domain result or publish a domain event (e.g., AgentExecutionFailed).
- **Cross-aggregate**: Communicate failure through domain events.
- **External system failures**: Translate into integration context events (e.g., CRMSyncFailed).
- **Human escalation**: Produce ApprovalRequested or Escalation events.
- **Compensation**: For long-running missions, failed executions may trigger RollbackExecution or compensating commands.

## Error vs Exception

A domain error is a modeled business outcome (e.g., LeadNotQualified). An infrastructure exception is a technical failure (e.g., network timeout). Domain errors are part of the model; infrastructure exceptions are handled by adapters and may be retried or translated.
