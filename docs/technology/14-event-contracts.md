# Event Contracts

## Standard Event Envelope

```json
{
  "eventId": "uuid",
  "eventType": "MissionApproved",
  "eventVersion": "1.0",
  "occurredAt": "2026-08-08T12:00:00Z",
  "tenantId": "tenant-uuid",
  "missionId": "mission-uuid",
  "agentId": "agent-uuid",
  "executionId": "execution-uuid",
  "correlationId": "uuid",
  "causationId": "uuid",
  "producer": "MissionManagementService",
  "payload": { },
  "metadata": { }
}
```

## Field Definitions

| Field | Required | Description |
|---|---|---|
| eventId | Yes | Unique event identifier |
| eventType | Yes | Domain event name |
| eventVersion | Yes | Semantic version of event schema |
| occurredAt | Yes | UTC timestamp |
| tenantId | Yes | Tenant context |
| missionId | No | Mission context if applicable |
| agentId | No | Agent context if applicable |
| executionId | No | Execution context if applicable |
| correlationId | Yes | End-to-end trace ID |
| causationId | No | ID of causing event/command |
| producer | Yes | Service/component that produced event |
| payload | Yes | Event-specific data |
| metadata | No | Extra routing/context |

## Event Versioning

- Events versioned semantically (major.minor.patch).
- Major version changes require new event type or new topic.
- Producers support multiple versions during migration.
- Consumers declare compatible versions.
- Schema registry recommended; Azure Schema Registry optional.

## Example Domain Events

| Event | Producer | Consumers |
|---|---|---|
| MissionApproved | Mission Management | Orchestrator, Analytics |
| AgentExecutionStarted | AI Execution Plane | Mission Management, Audit |
| AgentExecutionCompleted | AI Execution Plane | Mission Management, Analytics |
| LeadQualified | Lead Management | Mission Management, CRM, Analytics |
| OutreachSent | Outreach | Conversation, Analytics |
| ProspectReplied | Conversation | Mission Management, Conversation |
| MeetingBooked | Meeting | Mission Management, CRM |
| CRMOpportunityCreated | CRM Integration | Mission Management, Analytics |
| PolicyDefined | AI Governance | AI Execution, Audit |
| ApprovalRequested | AI Governance | Workflow, UI |
| ApprovalGranted | Approval Service | AI Execution, Audit |

## Integration Events

External system events mapped to integration event envelope before becoming domain events:

```json
{
  "eventId": "uuid",
  "eventType": "DynamicsOpportunityChanged",
  "source": "Dynamics365",
  "externalEventId": "...",
  "tenantId": "...",
  "payload": { }
}
```

## Idempotency and Deduplication

- Consumers track processed event IDs.
- External webhooks deduplicated by externalEventId.
- Commands use idempotency keys.

## Delivery Semantics

The event infrastructure guarantees **at-least-once delivery**. Consumers must be idempotent. Duplicate detection, outbox/transactional patterns, and idempotency keys are used to reduce duplicates, but they do not provide end-to-end exactly-once processing of business operations.

## AsyncAPI

Each bounded context publishes AsyncAPI contracts for its events and channels.
