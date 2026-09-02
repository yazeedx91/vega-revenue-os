# Domain Specifications

## Specification Pattern Usage

Specifications encapsulate boolean business rules that can be combined, tested, and reused across aggregates and domain services. They are value objects in the domain model.

## Specification Catalog

### CompanyMatchesICP

- **Purpose**: Determine whether a company matches a tenant's ICP
- **Inputs**: Company, ICPProfile
- **Rules**: Hard filters must pass; soft criteria contribute to score
- **Output**: Match result with score and evidence
- **Used By**: Company Intelligence, Lead Management, Mission Management

### ContactIsDecisionMaker

- **Purpose**: Determine whether a contact is a relevant decision-maker
- **Inputs**: Contact, DecisionMakerProfile, ICPProfile
- **Rules**: Role, seniority, and function match target criteria
- **Output**: Boolean or ranked score
- **Used By**: Contact Intelligence, Lead Management

### LeadIsQualified

- **Purpose**: Determine whether a lead meets qualification criteria
- **Inputs**: Lead, ICPProfile, signals, evidence, confidence threshold
- **Rules**: Hard filters pass, confidence threshold met, no disqualifiers
- **Output**: Qualification status with reason
- **Used By**: Lead & Qualification Management

### CompanyHasBuyingSignal

- **Purpose**: Determine whether a company has a relevant buying signal
- **Inputs**: Company, signal definitions, confidence threshold
- **Rules**: At least one signal of required strength and recency
- **Output**: Signal evaluation result
- **Used By**: Buying Signal Intelligence

### OutreachMayBeSent

- **Purpose**: Determine whether outreach may be sent autonomously
- **Inputs**: Draft message, recipient, policy, consent status, suppression list, autonomy level
- **Rules**: Not suppressed, policy allows, autonomy level allows, consent allows
- **Output**: Allow / RequireApproval / Deny with reason
- **Used By**: Outreach & Communication

### MeetingMayBeBooked

- **Purpose**: Determine whether a meeting may be booked
- **Inputs**: Meeting request, prospect qualification, calendar availability, policy
- **Rules**: Prospect qualified, required attendees available, policy allows
- **Output**: Allow / RequireApproval / Deny with reason
- **Used By**: Meeting & Scheduling

### OpportunityIsSalesQualified

- **Purpose**: Determine whether an opportunity is sales qualified
- **Inputs**: Opportunity, lead, meeting, qualification rules
- **Rules**: Meeting booked or completed, explicit interest, decision-maker associated
- **Output**: Boolean with reason
- **Used By**: Opportunity Management

### AgentMayActAutonomously

- **Purpose**: Determine whether an agent may execute an action without approval
- **Inputs**: Action type, agent, policy, autonomy level, confidence, risk
- **Rules**: Action allowed by policy, autonomy level permits, confidence sufficient, not destructive
- **Output**: Autonomous / RequireApproval / Deny
- **Used By**: AI Governance & Policy, AI Agent Management

### SuppressionApplies

- **Purpose**: Determine whether suppression blocks outreach
- **Inputs**: Contact, tenant suppression records, opt-out status
- **Rules**: Contact, domain, or company is suppressed or opted-out
- **Output**: Boolean with reason
- **Used By**: Compliance & Consent

### DataRetentionRequired

- **Purpose**: Determine whether data must be retained
- **Inputs**: Entity type, tenant retention policy, last activity, jurisdiction
- **Rules**: Retain audit logs; delete/anonymize prospect data per policy
- **Output**: Retain / Anonymize / Delete
- **Used By**: Compliance & Consent

## Composing Specifications

Specifications can be composed using AND, OR, and NOT operators. For example:

- `OutreachMayBeSent` = `NOT SuppressionApplies` AND `PolicyAllows` AND `AutonomyAllows`
- `LeadIsQualified` = `CompanyMatchesICP` AND `ContactIsDecisionMaker` AND `CompanyHasBuyingSignal`

## Specification Evaluation Context

Specifications should be evaluated within a domain service or aggregate method. They do not perform external calls; they operate on already-resolved domain objects.
