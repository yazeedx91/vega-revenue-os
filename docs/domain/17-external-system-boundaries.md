# External System Boundaries

## External Systems

The following external systems interact with the platform:

- Microsoft Dynamics 365 (CRM)
- Microsoft Graph (email and calendar)
- Zoom (meetings)
- Google Calendar / Google Meet (alternative meetings)
- Email transport providers (e.g., SMTP, SendGrid, Exchange Online)
- LinkedIn messaging (where supported by API)
- Web research providers and search APIs
- LLM providers (OpenAI, Anthropic, etc.)
- Identity providers (OIDC/OAuth2)
- Object storage providers (S3-compatible)

## External System Domain Treatment

External systems are not part of the core domain. The domain interacts with them through:

- **Anti-Corruption Layers (ACL)**: Prevent external models from leaking into the domain
- **Integration Events**: Capture changes from external systems
- **Application Services**: Coordinate domain commands with external calls

## Business System Boundary

See `ADR-125` and `docs/architecture/26-business-system-connector-architecture.md` for the canonical `IBusinessSystemConnector` abstraction. Microsoft Dynamics 365 is the **first connector**, not the only or architecturally central one; Salesforce, SAP, and custom industrial applications follow the same boundary.

### Domain Side

- Opportunity
- Company
- Contact
- Lead
- Activity
- Meeting

### External Side (Microsoft Dynamics 365 — first connector)

- Dynamics 365 Account
- Dynamics 365 Contact
- Dynamics 365 Lead
- Dynamics 365 Opportunity
- Dynamics 365 Activity
- Dynamics 365 Appointment

### Mapping Responsibility

- CRM Synchronization bounded context owns the mapping between domain objects and business-system entities.
- Core domain objects are provider-neutral.
- Provider-specific fields, lookups, and IDs are stored in CRMRecordReference or SyncMapping, not in core entities.
- Future connectors (Salesforce, SAP, custom industrial applications) implement the same `IBusinessSystemConnector` capability model without changing core domain objects.

## Calendar / Meeting Boundary

### Domain Side

- Meeting
- MeetingSlot
- Attendee

### External Side

- Zoom meeting
- Google Calendar event
- Outlook calendar event

### Mapping Responsibility

- Meeting & Scheduling context owns the domain meeting.
- External calendar adapters handle provider-specific APIs.
- Provider-specific IDs and links are stored in external references.

## Email / Messaging Boundary

### Domain Side

- Message
- Conversation
- OutreachCampaign

### External Side

- Email provider message ID
- LinkedIn conversation ID

### Mapping Responsibility

- Outreach & Communication context owns the domain message.
- External messaging adapters handle delivery.
- Delivery status and provider message IDs are stored in external references.

## Research Provider Boundary

### Domain Side

- CompanyResearch
- Evidence
- BuyingSignal

### External Side

- Search results
- Company data APIs
- News feeds

### Mapping Responsibility

- Company Intelligence and Buying Signal Intelligence contexts own domain research.
- External research service normalizes raw data into Evidence and Signals.
- Raw provider data is not stored in core aggregates.

## LLM Provider Boundary

### Domain Side

- Agent
- AgentExecution
- AgentOutcome

### External Side

- LLM API calls
- Prompts and completions
- Token usage

### Mapping Responsibility

- AI Agent Management context owns agent execution outcomes.
- LLM clients are infrastructure/application services.
- Token usage is emitted as usage events to Billing.

## Identity Provider Boundary

### Domain Side

- User
- TenantMembership
- Role

### External Side

- OIDC/OAuth2 identity provider

### Mapping Responsibility

- User & Identity Management context owns user lifecycle and roles.
- External identity provider handles authentication.
- Domain links external subject IDs to User aggregates.

## Boundary Rules

- External system concepts are never core domain entities.
- External IDs are stored as references or value objects in integration contexts.
- External failures are domain events in the integration context.
- The core domain remains testable without external systems.
