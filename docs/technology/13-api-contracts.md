# API Contracts

## Contract Style

OpenAPI 3.1 resource-oriented contracts. Each bounded context exposes its own contract aligned with the domain model.

## Mission API

| Endpoint | Method | Description |
|---|---|---|
| `/v1/missions` | POST | Create mission |
| `/v1/missions/{id}` | GET | Get mission |
| `/v1/missions/{id}` | PATCH | Update mission |
| `/v1/missions/{id}/approve` | POST | Approve mission |
| `/v1/missions/{id}/cancel` | POST | Cancel mission |
| `/v1/missions/{id}/tasks` | GET | List mission tasks |

Key fields: `missionId`, `tenantId`, `objective`, `constraints`, `icpId`, `budget`, `autonomyLevel`, `status`, `plan`, `outcomes`.

## Agent API

| Endpoint | Method | Description |
|---|---|---|
| `/v1/agents` | GET/POST | List/create agents |
| `/v1/agents/{id}` | GET/PATCH | Get/update agent |
| `/v1/agents/{id}/versions` | GET/POST | List/publish versions |
| `/v1/agents/{id}/executions` | GET/POST | List executions / trigger test |

Key fields: `agentId`, `name`, `role`, `capabilities`, `policies`, `modelConfig`, `autonomyLevel`, `lifecycle`.

## Task / Execution API

| Endpoint | Method | Description |
|---|---|---|
| `/v1/executions/{id}` | GET | Get execution status |
| `/v1/executions/{id}/events` | GET | Stream/list execution events |

Key fields: `executionId`, `tenantId`, `missionId`, `agentId`, `agentVersion`, `task`, `status`, `outcome`, `correlationId`.

## Lead / Company / Contact API

| Endpoint | Method | Description |
|---|---|---|
| `/v1/companies` | GET/POST | List/enrich companies |
| `/v1/companies/{id}` | GET | Get company |
| `/v1/contacts` | GET/POST | List/enrich contacts |
| `/v1/leads` | GET/POST | List/qualify leads |
| `/v1/leads/{id}/qualify` | POST | Submit qualification |

Key fields: `companyId`, `contactId`, `leadId`, `tenantId`, `research`, `icpScore`, `status`, `evidence`.

## Outreach / Conversation API

| Endpoint | Method | Description |
|---|---|---|
| `/v1/campaigns` | GET/POST | Outreach campaigns |
| `/v1/messages` | GET/POST | Messages / drafts |
| `/v1/conversations` | GET/POST | Conversations |
| `/v1/conversations/{id}/replies` | POST | Handle reply (webhook) |

## Meeting API

| Endpoint | Method | Description |
|---|---|---|
| `/v1/meetings` | GET/POST | List/book meetings |
| `/v1/meetings/{id}/cancel` | POST | Cancel meeting |
| `/v1/availability` | GET | Query availability |

## CRM Sync API

| Endpoint | Method | Description |
|---|---|---|
| `/v1/crm/connections` | GET/POST | CRM connection config |
| `/v1/crm/sync` | POST | Trigger sync |
| `/v1/crm/mappings` | GET/POST | Entity mappings |

## Approval / Policy API

| Endpoint | Method | Description |
|---|---|---|
| `/v1/approvals` | GET/POST | List/approve requests |
| `/v1/policies` | GET/POST | List/define policies |
| `/v1/autonomy-levels` | GET | Get autonomy configuration |

## Common Contract Patterns

- Tenant ID in header `X-Tenant-Id` or from JWT claim.
- Idempotency key header `Idempotency-Key`.
- Pagination with `cursor` or `offset`.
- Standard error envelope.
- Correlation ID in `X-Correlation-Id`.

## Contract Governance

- Contracts versioned independently.
- Breaking changes require new major version.
- Consumer contract tests via Pact.
