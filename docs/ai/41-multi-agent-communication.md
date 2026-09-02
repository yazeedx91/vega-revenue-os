# Multi-Agent Communication

## Purpose

If multiple agents are used, their communication must be bounded, secure, traceable, and resilient. Uncontrolled agent-to-agent conversations are forbidden.

## Communication Patterns

| Pattern | Use Case |
|---|---|
| Orchestrator delegation | Mission Orchestrator assigns tasks to agents |
| Event-driven handoff | Agent emits event; next agent consumes it |
| Request-response | Agent queries another agent for context |
| Shared state via persistence | Agents read/write mission/execution state via owned stores |

## Message Format

- Sender agent ID and version
- Recipient agent/role
- Tenant ID and mission ID
- Task definition
- Required input context
- Expected output
- Timeout
- Correlation ID
- Authorization token/context

## Boundaries

- Agents cannot grant capabilities to each other.
- Agents cannot bypass Policy Engine or Tool Gateway.
- Agents cannot access another tenant's data.
- Agents cannot modify mission objectives.
- Communication is observable and auditable.

## Discovery

- Agent registry lists available agents and capabilities.
- Orchestrator selects agents based on task and capability.
- Dynamic agent discovery allowed but governed by registry.

## Failure Handling

- Timeout and retry for inter-agent requests.
- Fallback agent selection if one fails.
- Escalate if no agent can complete task.
- Isolated failure does not crash other agents.

## Security

- Authenticated agent identities.
- Tenant-scoped messages.
- No secrets in messages.
- Messages logged for audit (sanitized).

## Multi-Agent Communication Diagram

```mermaid
sequenceDiagram
    participant MO as Mission Orchestrator
    participant A1 as Specialist Agent A
    participant A2 as Specialist Agent B
    participant Policy as Policy Engine
    participant Tool as Tool Gateway

    MO->>A1: Assign task
    A1->>Policy: Authorize action
    Policy-->>A1: ALLOW
    A1->>Tool: Execute tool
    Tool-->>A1: Result
    A1-->>MO: Task result + event
    MO->>A2: Assign next task
    A2->>Policy: Authorize action
    Policy-->>A2: ALLOW
    A2->>Tool: Execute tool
    Tool-->>A2: Result
    A2-->>MO: Task result
```
