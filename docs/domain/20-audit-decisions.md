# Auditable Domain Decisions

## Decision Audit Requirements

The following business decisions must be explainable and auditable:

### Mission Decisions

| Decision | Why Auditable | Data to Record |
|---|---|---|
| Mission approved | Authority and objective traceability | Approver, objective, ICP, timestamp |
| Mission started | Execution authorization | User/system trigger, plan, timestamp |
| Mission paused/cancelled | Operational control | Actor, reason, timestamp |
| Mission completed/failed | Outcome attribution | Success criteria, actual outcome, timestamp |

### ICP Decisions

| Decision | Why Auditable | Data to Record |
|---|---|---|
| ICP configured | Targeting rules affect fairness and scope | Configurer, rules, timestamp |
| Company matched against ICP | Determines who is targeted | Score, evidence, rule version |

### Lead Decisions

| Decision | Why Auditable | Data to Record |
|---|---|---|
| Lead qualified | Determines outreach eligibility | Evidence, confidence, scorer, timestamp |
| Lead disqualified | Prevents unfair exclusion | Reason, evidence, timestamp |
| Lead converted | Pipeline creation | Source lead, opportunity reference |

### Outreach Decisions

| Decision | Why Auditable | Data to Record |
|---|---|---|
| Outreach drafted | Content generation | Model/agent version, inputs, template |
| Outreach approved | Authorization to contact | Approver, message, recipient |
| Outreach blocked | Compliance or policy | Policy, reason, timestamp |
| Outreach sent | Contact attempt | Sender, recipient, channel, timestamp |

### Conversation Decisions

| Decision | Why Auditable | Data to Record |
|---|---|---|
| Reply interpreted | AI understanding | Model, conversation state, interpretation |
| Conversation qualified | Escalation to meeting | Evidence, confidence, timestamp |
| Conversation closed | End of engagement | Reason, final state |

### Meeting Decisions

| Decision | Why Auditable | Data to Record |
|---|---|---|
| Meeting requested | Scheduling intent | Requester, attendees, proposed times |
| Meeting booked | Commitment | Confirmed time, attendees, provider |
| Meeting cancelled/no-show | Outcome tracking | Reason, timestamp |

### Opportunity Decisions

| Decision | Why Auditable | Data to Record |
|---|---|---|
| Opportunity created | Pipeline entry | Lead, meeting, evidence |
| Opportunity qualified | Stage progression | Evidence, scorer |
| Opportunity won/lost | Revenue outcome | Value, reason, timestamp |

### AI Agent Decisions

| Decision | Why Auditable | Data to Record |
|---|---|---|
| Task assigned to agent | Work allocation | Mission, agent, task definition |
| Agent action executed | Autonomous behavior | Agent version, inputs, outputs |
| Agent escalated | Human intervention | Reason, confidence, policy |
| Agent execution failed/rolled back | Failure handling | Reason, compensations |

### Policy Decisions

| Decision | Why Auditable | Data to Record |
|---|---|---|
| Autonomy level set | Scope of AI authority | Configurer, level, timestamp |
| Policy defined/changed | Governance | Configurer, rules, timestamp |
| Approval required | Oversight | Action, approver, timestamp |

### Compliance Decisions

| Decision | Why Auditable | Data to Record |
|---|---|---|
| Consent granted/withdrawn | Legal basis | Contact, source, timestamp |
| Suppression added/removed | Contact rights | Actor, reason, timestamp |
| Data retention action | Privacy | Entity type, action, timestamp |

## Audit Record Structure

Each auditable decision should produce an AuditRecord with:

- TenantId
- ActorId (user or agent)
- ActionType
- TargetEntityType and TargetEntityId
- Decision / Outcome
- Reason or explanation
- Evidence references
- Timestamp
- CorrelationId (linking related events)

## Explainability Requirements

- AI-generated decisions must include confidence scores and source citations where applicable.
- Policy-based decisions must reference the policy version and rule.
- Human decisions must record the actor and rationale.
- Audit records are append-only and immutable.
