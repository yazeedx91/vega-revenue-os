# Mission Model

## What Is a Mission

A Mission is a business task assigned to the AI employee. It represents a scoped, measurable, time-bound revenue objective with defined constraints and approval rules.

## Mission Attributes

- **Objective**: What the mission must achieve
- **Target**: The ICP and territory configuration
- **Constraints**: Allowed channels, budgets, working hours, and policies
- **Budget**: AI execution credit or cost allowance
- **Timeframe**: Start and end date, or cadence
- **Priority**: Mission priority relative to others
- **Success criteria**: Thresholds for success
- **Allowed actions**: What the AI may do
- **Forbidden actions**: What the AI may not do
- **Approval requirements**: Which actions require human approval
- **Owner**: The human owner of the mission
- **Status**: Current lifecycle state
- **Expected outcome**: Forecasted result
- **Actual outcome**: Measured result

## Mission Lifecycle States

| State | Meaning |
|---|---|
| Draft | Mission is being configured but not yet active |
| Approved | Mission approved and ready to launch |
| Scheduled | Approved but waiting for scheduled start |
| Planning | AI is planning the sequence of actions |
| Executing | AI is performing tasks |
| Paused | Temporarily suspended by a user or policy |
| Awaiting Approval | AI stopped for human decision |
| Blocked | Cannot proceed due to an exception or dependency |
| Completed | Mission achieved its objective or end state |
| Failed | Mission did not achieve acceptable outcomes |
| Cancelled | Stopped by a user before completion |
| Archived | Mission retained for learning only |

## State Transition Rules

- Draft → Approved: requires human approval if autonomy level demands
- Approved → Scheduled or Planning: based on start time
- Planning → Executing: once plan is valid
- Executing → Awaiting Approval: when a high-risk action is proposed
- Awaiting Approval → Executing or Cancelled: based on human decision
- Executing → Paused: by human or policy trigger
- Paused → Executing or Cancelled: by human or policy
- Executing/Planning → Blocked: on unresolvable exception
- Blocked → Executing or Failed: after resolution or timeout
- Executing → Completed: when success criteria met
- Executing → Failed: when success criteria unmet and timeframe expires
- Any non-archived → Cancelled: by authorized human
- Completed/Failed/Cancelled → Archived: after review period

## Branching and Exceptions

Missions may branch based on:

- Prospect behavior
- Confidence levels
- Signal changes
- Human approvals
- Exceptions (e.g., calendar failure, CRM error)

The AI must always record the reason for a branch or state change.
