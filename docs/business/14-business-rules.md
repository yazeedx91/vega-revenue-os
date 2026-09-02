# Business Rules

## Lead Qualification Rules

- A company must satisfy all hard ICP filters before being considered a lead
- Required evidence must be present for each positive signal
- A company must be scored above the qualification threshold
- Qualification status must explain its components
- A lead may be disqualified at any point if negative signals appear

## Opportunity Qualification Rules

- An opportunity requires a qualified prospect, a scheduled or completed meeting, and explicit buying interest
- The opportunity must be associated with a decision-maker or influencer
- The opportunity must map to the customer's defined stages
- AI may create an opportunity only if autonomy level permits

## Disqualification Rules

- Missing required evidence
- Hard filter failure
- Disqualifier signal present
- Prospect explicitly opts out
- Company on suppression list
- Negative news or bankruptcy
- Out of configured territory
- Duplicate of an existing account

## Outreach Rules

- Outreach must be personalized based on research
- Outreach must use approved templates and tone
- Outreach must respect working hours and timezone
- Outreach must not misrepresent facts
- High-risk or sensitive outreach requires human approval
- No outreach to suppressed or opted-out contacts

## Follow-Up Rules

- Follow-ups are limited to a configured cadence
- No follow-up after explicit opt-out
- Follow-up messaging must adapt to prior replies
- Escalate to human if the prospect asks complex or non-standard questions

## Meeting Scheduling Rules

- Schedule only with qualified prospects
- Include required customer attendees
- Respect calendar availability and working hours
- Confirm the meeting purpose and channel
- Record the meeting in the CRM and mission

## Human Escalation Rules

- Escalate if AI confidence is below threshold
- Escalate for pricing, negotiation, or contractual topics
- Escalate for legal, compliance, or sensitive industry questions
- Escalate for unusual or hostile prospect behavior
- Escalate if the prospect requests a human

## Autonomous Action Rules

- The AI may only perform actions within the allowed action list
- High-impact actions require human approval or autonomy level 4+
- Destructive actions always require approval
- AI actions are logged and auditable

## CRM Synchronization Rules

- Map all CRM entities to provider-neutral domain objects
- Avoid duplicate accounts, contacts, and opportunities
- Synchronize after each significant state change
- Maintain an audit log of all CRM writes

## Duplicate Detection Rules

- Detect duplicates by domain, email, company name, and CRM ID
- Merge or flag duplicates before outreach
- Never outreach the same contact for the same mission twice

## ICP Rules

- ICP is configurable per tenant
- Hard filters are enforced before outreach
- Soft criteria affect score
- Confidence threshold must be met for each stage

## Buying Signal Rules

- Each signal must have a source and date
- Signals expire after a configurable period
- Multiple weak signals may combine for a stronger score
- Negative signals reduce or disqualify

## Confidence Threshold Rules

- Research confidence threshold for outreach
- Qualification confidence threshold for meeting
- Opportunity confidence threshold for CRM creation
- Customer may configure thresholds

## Compliance Rules

- Respect opt-outs and suppression lists
- Capture and honor consent where required
- Retain data only for the configured period
- Provide audit trail for all communications
- Mark communications that require legal review

## Data Retention Rules

- Retain prospect data per tenant policy
- Delete or anonymize data after retention period
- Support right-to-delete requests
- Separate tenant data and backups
