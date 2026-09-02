# AI Execution Contract

## Purpose

Canonical contract for requesting and tracking an AI agent execution.

## Request Contract

```json
{
  "executionId": "uuid",
  "tenantId": "tenant-uuid",
  "missionId": "mission-uuid",
  "agentId": "agent-uuid",
  "agentVersion": "1.2.3",
  "taskId": "task-uuid",
  "taskType": "ResearchCompany",
  "correlationId": "uuid",
  "context": {
    "mission": { },
    "plan": { },
    "target": { },
    "constraints": [ ]
  },
  "capabilities": ["ResearchCompany", "EnrichContact"],
  "policyContext": {
    "autonomyLevel": 3,
    "riskCategory": "LOW",
    "tenantPolicyVersion": "2.1.0",
    "missionPolicyVersion": "1.0.0"
  },
  "budget": {
    "maxTokens": 10000,
    "maxCostUsd": 0.50,
    "maxDurationSeconds": 60
  },
  "deadline": "2026-08-08T13:00:00Z",
  "idempotencyKey": "uuid",
  "metadata": { }
}
```

## Response / Outcome Contract

```json
{
  "executionId": "uuid",
  "tenantId": "tenant-uuid",
  "missionId": "mission-uuid",
  "status": "COMPLETED",
  "outcome": {
    "summary": "...",
    "decisions": [ ],
    "actions": [ ],
    "evidence": [ ]
  },
  "modelUsage": {
    "model": "gpt-4o",
    "inputTokens": 1500,
    "outputTokens": 300,
    "costUsd": 0.012
  },
  "startedAt": "...",
  "completedAt": "...",
  "correlationId": "uuid",
  "events": ["AgentExecutionCompleted"]
}
```

## Status Values

- PENDING
- RUNNING
- AWAITING_APPROVAL
- PAUSED
- COMPLETED
- FAILED
- CANCELLED
- TIMED_OUT

## Field Definitions

| Field | Required | Description |
|---|---|---|
| executionId | Yes | Unique execution ID |
| tenantId | Yes | Tenant context |
| missionId | No | Mission context |
| agentId | Yes | Agent identity |
| agentVersion | Yes | Specific agent version |
| taskId | Yes | Task identity |
| taskType | Yes | Type of task |
| correlationId | Yes | Trace ID |
| context | Yes | Mission/plan/target data |
| capabilities | Yes | Allowed capabilities for this execution |
| policyContext | Yes | Autonomy, risk, policy versions |
| budget | Yes | Token/cost/time limits |
| deadline | No | Execution deadline |
| idempotencyKey | Yes | Safe retry key |

## Event Emissions

- `AgentExecutionStarted`
- `AgentExecutionCompleted`
- `AgentExecutionFailed`
- `AgentExecutionAwaitingApproval`
- `AgentExecutionCancelled`
- `AgentExecutionTimedOut`

## Transport

- Request: Azure Service Bus queue `agent.commands`.
- Outcome: Azure Service Bus topic `agent.events`.
