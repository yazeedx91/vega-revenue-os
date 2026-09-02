# Domain Services

## Domain Service Catalog

| Service | Responsibility | Input | Output | Context |
|---|---|---|---|---|
| LeadQualificationService | Evaluate a lead against qualification criteria | Lead, ICPProfile, signals, conversation | Qualification result | Lead & Qualification Management |
| OpportunityScoringService | Score an opportunity based on data and signals | Opportunity, lead, meeting, signals | OpportunityScore | Opportunity Management |
| ICPMatchingService | Determine how well a company/contact matches an ICP | Company/Contact, ICPProfile | ICPMatch with score | ICP & Market Strategy |
| BuyingSignalEvaluationService | Evaluate raw signals into scored buying signals | Raw signal data, ICP | BuyingSignal | Buying Signal Intelligence |
| MeetingAvailabilityService | Find available meeting slots across calendars | Attendees, duration, time windows | Available slots | Meeting & Scheduling |
| RevenueAttributionService | Attribute revenue outcomes to missions and campaigns | Opportunity, mission, campaign, timeline | Attribution record | Revenue Analytics |
| PolicyEvaluationService | Evaluate whether an action is allowed by policy | Action, agent, prospect, autonomy level | PolicyDecision | AI Governance & Policy |
| AutonomyDecisionService | Decide if an agent may act autonomously | Action type, policy, confidence, risk | Autonomy decision | AI Governance & Policy |
| ApprovalRoutingService | Route an action to the appropriate approver | Action, policy, tenant | Approval request | AI Governance & Policy |
| DuplicateDetectionService | Detect duplicate companies, contacts, leads | Candidate, existing records | Duplicate result | Company Intelligence / Lead Management |
| PersonalizationService | Generate personalized outreach content | Prospect, research, templates | Draft message | Outreach & Communication |
| ConversationQualificationService | Assess conversation state for qualification | Conversation, messages, rules | Qualification status | Conversation Management |
| SuppressionCheckService | Determine if a contact is suppressed or opted-out | Contact, tenant | Suppression status | Compliance & Consent |
| TenantIsolationService | Enforce tenant boundaries on queries/commands | Query/command, user context | Scoped query/command | Cross-cutting (not a domain service; enforcement layer) |

## Why These Are Domain Services

These operations involve multiple aggregates, external policies, or complex cross-cutting rules that do not naturally belong to a single entity. They are stateless with respect to the domain and operate on entities/aggregates passed to them.

## What Is NOT a Domain Service

- Direct database queries
- API client calls
- LLM provider invocations
- Email transport
- File storage
- Authentication token validation

These are infrastructure concerns and belong to application services or adapters, not the domain model.
