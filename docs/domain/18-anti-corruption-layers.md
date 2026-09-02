# Anti-Corruption Layers

## ACL Locations

| External System | ACL Context | Domain Objects | External Objects |
|---|---|---|---|
| Microsoft Dynamics 365 | CRM Synchronization | Company, Contact, Lead, Opportunity, Activity, Meeting | Dynamics 365 Account, Contact, Lead, Opportunity, Activity, Appointment |
| Microsoft Graph | Meeting & Scheduling / Outreach | Meeting, Message | Outlook Event, Exchange Message |
| Zoom | Meeting & Scheduling | Meeting, MeetingSlot | Zoom Meeting, Zoom Session |
| Google Calendar / Meet | Meeting & Scheduling | Meeting, MeetingSlot | Google Event, Meet Link |
| Email Providers | Outreach & Communication | Message, Conversation | Provider message/thread IDs |
| LinkedIn | Outreach & Communication | Message, Conversation | LinkedIn conversation IDs |
| Research Providers | Company Intelligence | CompanyResearch, Evidence, BuyingSignal | Search results, API records |
| LLM Providers | AI Agent Management (via infrastructure) | AgentExecution, AgentOutcome | Prompt/completion APIs |
| Identity Providers | User & Identity Management | User, TenantMembership | OIDC claims, subject IDs |
| Object Storage | Infrastructure | File attachments, exports | S3 object keys |

## Business System ACL (Dynamics 365 — First Connector)

See `ADR-125` and `docs/architecture/26-business-system-connector-architecture.md` for the canonical `IBusinessSystemConnector` abstraction. This section describes the Dynamics 365 connector as the first concrete instance; the same ACL pattern applies to future connectors (Salesforce, SAP, custom industrial applications).

### Responsibility

- CRM Synchronization bounded context translates between domain objects and Dynamics 365 Dataverse/Web API entities.
- The ACL ensures no Dynamics-specific concepts leak into Mission, Lead, Opportunity, or Company aggregates.

### Mapping Examples

| Domain Object | Dynamics 365 Entity | Notes |
|---|---|---|
| Company | Account | Name, industry, address mapped |
| Contact | Contact | Name, email, phone, company reference |
| Lead | Lead | Maps to domain Lead when synced |
| Opportunity | Opportunity | Maps to domain Opportunity; includes amount, stage |
| Meeting | Appointment | Maps to domain Meeting |
| Activity | Task/PhoneCall | Generic activity representation |

### External IDs

- Dynamics AccountId, ContactId, LeadId, OpportunityId are stored in CRMRecordReference value objects or SyncMapping entities.
- Core domain objects never expose Dynamics IDs.

## Graph/Calendar/Zoom ACL

### Responsibility

- Meeting & Scheduling context owns the domain meeting.
- External calendar adapters translate between Meeting/MeetingSlot and provider-specific events.
- Zoom adapter translates between Meeting and Zoom meeting resources.

### Mapping Examples

| Domain Object | External Object | Notes |
|---|---|---|
| Meeting | Outlook Event / Google Event / Zoom Meeting | Provider-specific IDs stored externally |
| MeetingSlot | Event time proposal | Timezone and availability handled by adapter |
| Attendee | Participant / Required attendee | Email-based matching |

## Email/Messaging ACL

### Responsibility

- Outreach & Communication context owns the domain message.
- External email/messaging adapters handle delivery and status.

### Mapping Examples

| Domain Object | External Object | Notes |
|---|---|---|
| Message | Email message / LinkedIn message | Provider message ID stored externally |
| Conversation | Email thread / LinkedIn thread | Thread ID stored externally |

## Research Provider ACL

### Responsibility

- External research service normalizes provider data into domain Evidence and BuyingSignal.
- Raw search results or API records are not stored in core aggregates.

### Mapping Examples

| Domain Object | External Input | Notes |
|---|---|---|
| Evidence | Search result, news article, company page | Source citation preserved |
| BuyingSignal | Detected signal from raw data | Confidence and source recorded |

## ACL Design Rules

- ACLs live in integration or supporting contexts, never in the core domain.
- Core domain commands and events are provider-agnostic.
- External failures are translated into domain events (e.g., CRMSyncFailed).
- External IDs are stored as value objects or references, not as entity identity.
- ACL mappings are versioned and configurable per tenant where possible.
