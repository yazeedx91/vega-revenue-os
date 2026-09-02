# Autonomy Model

## Configurable Autonomy Levels

| Level | Name | Description |
|---|---|---|
| 0 | Human Only | No AI action without explicit human command |
| 1 | AI Recommendation | AI suggests; human decides and executes |
| 2 | AI Draft + Human Approval | AI drafts actions; human approves before execution |
| 3 | AI Executes Low-Risk Actions | AI executes low-risk actions within policy; high-risk requires approval |
| 4 | AI Autonomous Execution Within Policy | AI executes within policy; only destructive or contractual actions require approval |
| 5 | Fully Autonomous Mission Execution | AI runs full missions within policy; human monitors |

## What Each Level Permits

### Level 0 — Human Only

- AI may not perform any action
- AI may provide research summaries on request

### Level 1 — AI Recommendation

- AI recommends companies, contacts, and messages
- Human selects and executes all actions

### Level 2 — AI Draft + Human Approval

- AI drafts outreach, follow-ups, and meeting requests
- Human reviews and approves before sending
- AI may perform low-risk research autonomously

### Level 3 — AI Executes Low-Risk Actions

- AI sends approved-template, low-risk outreach
- AI handles routine replies
- AI schedules meetings with qualified prospects
- High-risk and sensitive actions require approval

### Level 4 — AI Autonomous Execution Within Policy

- AI plans and executes missions within policy
- AI may qualify prospects and book meetings
- Destructive actions, pricing, contracts, and ICP changes require approval

### Level 5 — Fully Autonomous Mission Execution

- AI runs complete missions within policy
- Continuous monitoring by humans
- Emergency stop and override available
- High-stakes commitments still gated

## Guardrails

- Autonomy never bypasses security, compliance, or customer-defined policies
- AI cannot commit to pricing, contracts, or legal terms
- AI cannot contact suppressed or opted-out prospects
- AI must escalate when uncertain
- AI must log every autonomous action

## Autonomy Configuration

- Default level per tenant
- Per-mission override
- Per-action-type override
- Industry or prospect sensitivity may raise effective level
- Compliance admin can set maximum allowed level

## Autonomy and Human Oversight

The autonomy model is the business complement to the human oversight model. Higher autonomy increases throughput; lower autonomy increases control. The customer chooses the trade-off per mission or per tenant.
