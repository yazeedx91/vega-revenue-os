# Human Oversight Model

## When Humans Are Required

- Mission approval (if policy requires)
- ICP or strategy changes
- High-risk outreach
- Outreach to sensitive industries
- Low-confidence AI output
- Legal or compliance concerns
- Pricing or negotiation topics
- Unusual prospect behavior
- AI uncertainty above threshold
- Meeting with high-value prospect
- CRM opportunity creation
- Escalation by the AI
- Complaint or opt-out investigation

## Approval Thresholds

| Autonomy Level | Approval Required For |
|---|---|
| Level 0 | All actions |
| Level 1 | All actions; AI only recommends |
| Level 2 | Sending drafts; low-risk research may be autonomous |
| Level 3 | High-risk or sensitive actions; low-risk may execute |
| Level 4 | Destructive or contractual actions; most else autonomous |
| Level 5 | Within policy; full mission autonomy with monitoring |

## Escalation Rules

- Escalate when AI confidence is below threshold
- Escalate when the prospect requests a human
- Escalate when an action is outside allowed list
- Escalate on compliance or policy violation
- Escalate on repeated negative prospect response
- Escalate on CRM or calendar failure

## Human Override

- Authorized users can pause, edit, or cancel any AI action
- Override is logged with reason
- AI must respect the override and adjust its plan
- Override can apply to a single action, a mission, or an agent

## Emergency Stop

- Compliance and tenant administrators can suspend all AI activity
- Emergency stop applies to the entire tenant or a specific mission
- Stop is immediate and audited
- Resume requires explicit authorization and review

## Agent Suspension

- Individual agents can be suspended
- Suspension is logged and may trigger mission pause
- Re-activation requires review

## Mission Suspension

- A mission can be suspended by authorized users
- All pending actions are held
- Reason for suspension is recorded
- Resume or cancellation is a human decision

## Oversight Dashboard

- Pending approvals
- Recent escalations
- Suspended missions
- Compliance alerts
- Performance exceptions
- AI accuracy warnings

## Roles and Oversight

| Role | Oversight Actions |
|---|---|
| Revenue Manager | Approve missions, outreach, ICP changes |
| Sales Manager | Approve target contacts, review meetings |
| Compliance Admin | Audit, suspend, enforce policies |
| Administrator | System-level overrides, tenant suspension |
