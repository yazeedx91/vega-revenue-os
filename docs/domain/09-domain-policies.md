# Domain Policies

## Policy Catalog

### LeadQualificationPolicy

- **Purpose**: Determine whether a lead is qualified
- **Inputs**: Lead, ICPProfile, buying signals, evidence, confidence thresholds
- **Decision**: Qualified / NotQualified / Disqualified
- **Rules**:
  - Hard ICP filters must pass
  - Required evidence must be present
  - Overall confidence must exceed the configured threshold
  - No active suppression or opt-out
- **Outputs**: QualificationStatus, reason, confidence
- **Owner**: Revenue Mission Management / Lead & Qualification Management
- **Override**: Sales Manager or Revenue Manager can manually qualify/disqualify with reason

### ICPMatchingPolicy

- **Purpose**: Score how well a company/contact matches an ICP
- **Inputs**: Company/Contact, ICPProfile
- **Decision**: Match score and pass/fail
- **Rules**:
  - Hard filters are binary
  - Soft criteria contribute to score
  - Positive signals increase score
  - Negative signals decrease score or fail
- **Outputs**: ICPMatch with score and evidence
- **Owner**: ICP & Market Strategy
- **Override**: Revenue Manager can adjust weights

### OutreachPolicy

- **Purpose**: Govern whether outreach may be sent
- **Inputs**: Draft message, recipient, channel, time, autonomy level
- **Decision**: Allow / RequireApproval / Deny
- **Rules**:
  - No outreach to suppressed/opted-out contacts
  - Respect working hours and timezone
  - High-risk or sensitive content requires approval
  - Must use approved template/tone
- **Outputs**: PolicyDecision with reason
- **Owner**: AI Governance & Policy
- **Override**: Compliance Admin or authorized manager

### AutonomyPolicy

- **Purpose**: Determine if an agent may execute an action autonomously
- **Inputs**: Action type, agent, mission, autonomy level, risk score, confidence
- **Decision**: Autonomous / RequireApproval / Deny
- **Rules**:
  - Destructive actions always require approval
  - Contractual/pricing actions always require approval
  - Low-confidence actions require approval
  - Autonomy level caps autonomous actions
- **Outputs**: Autonomy decision with reason
- **Owner**: AI Governance & Policy
- **Override**: Compliance Admin can raise required level

### ApprovalPolicy

- **Purpose**: Define who can approve which actions
- **Inputs**: Action type, tenant, user role
- **Decision**: Approver list / escalation path
- **Rules**:
  - High-value actions require senior approval
  - Compliance actions require compliance admin
  - Urgent actions may escalate
- **Outputs**: Approval route
- **Owner**: AI Governance & Policy
- **Override**: Administrator can bypass with audit

### SuppressionPolicy

- **Purpose**: Enforce do-not-contact rules
- **Inputs**: Contact, tenant, suppression records, opt-out status
- **Decision**: Allowed / Suppressed
- **Rules**:
  - Explicit opt-out suppresses all outreach
  - Competitor domains suppress
  - Customer-defined blacklist suppresses
- **Outputs**: Suppression result with reason
- **Owner**: Compliance & Consent
- **Override**: Compliance Admin only

### MeetingBookingPolicy

- **Purpose**: Govern meeting scheduling
- **Inputs**: Meeting request, attendees, calendar availability, qualification status
- **Decision**: Allow / RequireApproval / Deny
- **Rules**:
  - Only qualified prospects may be scheduled
  - Required customer attendees must be included
  - Working hours and timezones respected
- **Outputs**: PolicyDecision
- **Owner**: Meeting & Scheduling
- **Override**: Sales Manager

### CRMOpportunityPolicy

- **Purpose**: Govern CRM opportunity creation
- **Inputs**: Opportunity, meeting, qualification, autonomy level
- **Decision**: Allow / RequireApproval / Deny
- **Rules**:
  - Opportunity must have qualified prospect and meeting
  - Duplicate detection must pass
  - Autonomy level must allow CRM writes
- **Outputs**: PolicyDecision
- **Owner**: CRM Synchronization
- **Override**: Sales Manager or Revenue Manager

### EscalationPolicy

- **Purpose**: Determine when and how to escalate to humans
- **Inputs**: AI confidence, prospect behavior, action risk, policy
- **Decision**: Escalate / DoNotEscalate
- **Rules**:
  - Confidence below threshold triggers escalation
  - Unusual prospect requests trigger escalation
  - Policy violations trigger escalation
  - Prospect explicitly requests human
- **Outputs**: Escalation record with reason
- **Owner**: AI Governance & Policy
- **Override**: Human accepts or dismisses escalation

### CompliancePolicy

- **Purpose**: Enforce compliance constraints on AI actions
- **Inputs**: Action, jurisdiction, consent status, data sensitivity
- **Decision**: Allow / Block / RequireReview
- **Rules**:
  - No outreach without legal basis where required
  - PII handling rules apply
  - Jurisdiction-specific restrictions apply
- **Outputs**: Compliance decision
- **Owner**: Compliance & Consent
- **Override**: Compliance Admin with legal review marker

### DataRetentionPolicy

- **Purpose**: Govern retention and deletion of domain data
- **Inputs**: Entity type, tenant retention configuration, last activity date
- **Decision**: Retain / Anonymize / Delete
- **Rules**:
  - Retain audit logs for required period
  - Anonymize or delete prospect data per policy
  - Support right-to-delete requests
- **Outputs**: Retention action
- **Owner**: Compliance & Consent / Audit
- **Override**: Compliance Admin
