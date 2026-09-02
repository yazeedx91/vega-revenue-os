# Autonomy Control Architecture

## Autonomy Levels

The architecture supports six configurable autonomy levels aligned with the domain model:

| Level | Name | Runtime Behavior |
|---|---|---|
| 0 | Human Only | Agent provides data only when explicitly requested; no autonomous actions. |
| 1 | AI Recommendation | Agent drafts recommendations; human reviews and triggers execution. |
| 2 | AI Draft + Human Approval | Agent drafts actions; system pauses for human approval before execution. |
| 3 | Controlled Autonomous Actions | Agent executes low-risk actions; high-risk actions require approval. |
| 4 | Policy-Bounded Autonomous Execution | Agent executes most actions within policy; destructive/contractual actions require approval. |
| 5 | Highly Autonomous Mission Execution | Agent runs full missions within policy; continuous monitoring and emergency stop. |

## Autonomy Enforcement Points

1. **Control Plane policy evaluation**: Before any action, the control plane evaluates whether autonomy level permits it.
2. **Workflow engine gates**: Human approval tasks inserted when required.
3. **Tool executor**: Rejects unauthorized tool calls.
4. **Outbound communication gateway**: Blocks unapproved messages.
5. **CRM integration**: Requires approval for CRM writes above configured level.

## Autonomy Configuration

- Default autonomy level per tenant.
- Per-mission override.
- Per-action-type override.
- Industry/prospect sensitivity can raise effective level.
- Compliance admin can set maximum allowed level.
- Feature flags can restrict access to higher levels.

## Autonomy Decision Flow

```mermaid
sequenceDiagram
    participant EP as Execution Plane
    participant CP as Control Plane
    participant WF as Workflow Engine
    participant HU as Human User

    EP->>CP: Evaluate action autonomy
    CP->>CP: Check policy + level
    alt Allow
        CP-->>EP: ALLOW
        EP->>EP: Execute
    else Require Approval
        CP-->>EP: REQUIRE_APPROVAL
        EP->>WF: Create approval task
        WF->>HU: Notify
        HU->>WF: Approve/Reject
        WF-->>EP: Decision
    else Deny
        CP-->>EP: DENY
        EP->>EP: Escalate/abort
    end
```

## Non-Bypassable Guards

No autonomy level may bypass:

- Authentication and authorization
- Tenant isolation
- Policy rules
- Compliance constraints
- Approval requirements for destructive/contractual actions
- Audit logging

## Emergency Override

- Authorized users can pause or cancel any mission, workflow, or execution.
- Emergency stop propagates via events.
- All overrides are audited.

## Monitoring

- Track human intervention rate by tenant/mission.
- Track autonomous completion rate.
- Alert on autonomy policy violations.
- Review high-level autonomy changes.
