# Value Objects

## Value Object Catalog

| Value Object | Definition | Validation Rules | Used By |
|---|---|---|---|
| TenantId | Unique tenant identifier | UUID format, non-empty | All tenant-scoped aggregates |
| OrganizationId | Organization identifier | UUID format | Tenant & Organization Management |
| UserId | User identifier | UUID format | User & Identity Management |
| EmailAddress | Valid email address | Format validation, domain check | Contact, User, Message |
| PhoneNumber | Valid phone number | E.164 or configurable format | Contact, User |
| PersonName | Person's name | Non-empty, length limits | Contact, User |
| Address | Physical or mailing address | Country, city, postal code | Company, Contact |
| CompanyName | Name of an organization | Non-empty | Company |
| CompanyIdentifier | External identifier for a company | Source + value | Company, ExternalReference |
| DomainName | Internet domain | Valid domain format | Company, SuppressionRecord |
| Industry | Industry classification | Standard or tenant-defined | ICPProfile, Company |
| Geography | Geographic region/country/city | Valid codes | ICPProfile, Company |
| RevenueRange | Revenue band | Min/max, currency | ICPProfile, Company |
| EmployeeRange | Employee count band | Min/max | ICPProfile, Company |
| Technology | Technology product or stack | Name + category | ICPProfile, Company |
| ERPSystem | ERP product indicator | Name + version optional | Company |
| CRMProduct | CRM product indicator | Name | CRMConnection |
| Currency | ISO currency code | ISO 4217 | Money, UsageRecord |
| Money | Monetary amount with currency | Amount + Currency | Opportunity, Billing |
| Percentage | Ratio 0–100 | Range validation | ConfidenceScore, OpportunityScore |
| ConfidenceScore | Normalized confidence 0–1 | Range, source | Qualification, BuyingSignal, AgentOutcome |
| Priority | Mission or task priority | Enum: Low, Medium, High, Critical | Mission, AgentTask |
| MissionObjective | Objective statement with target | Text + metric + target | Mission |
| AutonomyLevel | Configured autonomy level | Enum 0–5 | Policy, Mission |
| ConsentStatus | Consent state | Enum: Granted, Withdrawn, Pending, NotRequired | Consent |
| QualificationStatus | Lead/opportunity qualification | Enum: Unqualified, Qualified, Disqualified | Lead, Opportunity |
| MeetingSlot | Proposed calendar slot | Start, end, timezone, attendees | Meeting |
| TimeRange | Time interval | Start <= End | MeetingSlot, Availability |
| DateRange | Date interval | Start <= End | Mission, ICPProfile |
| SignalStrength | Strength of a buying signal | Enum: Weak, Moderate, Strong | BuyingSignal |
| SignalType | Category of signal | Enum: Hiring, Funding, Expansion, etc. | BuyingSignal |
| MessageStatus | Status of a message | Enum: Draft, Pending, Sent, Delivered, Failed | Message |
| MeetingStatus | Status of a meeting | Enum per state machine | Meeting |
| ExecutionStatus | Agent execution status | Enum per state machine | AgentExecution |
| ApprovalStatus | Approval state | Enum: Pending, Approved, Rejected, Escalated | Approval |
| PolicyDecision | Result of policy evaluation | Allow / Deny + reason | Policy evaluation |
| SourceCitation | Reference to a data source | Title, URL, date, confidence | Evidence, KnowledgeItem |
| MessageContent | Content and channel of a message | Text/HTML, channel, tone | Message |
| ChannelType | Communication channel | Enum: Email, LinkedIn, etc. | Outreach & Communication |
| DisqualificationReason | Reason a lead was disqualified | Enum + details | Lead |
| SuppressionReason | Reason a contact is suppressed | Enum + details | SuppressionRecord |

## Design Rationale

Value objects are immutable and compared by value. They are used for data points that do not have a meaningful independent lifecycle, such as email addresses, confidence scores, and time ranges. Entities that require tracking changes, identity, or state transitions are not value objects.
