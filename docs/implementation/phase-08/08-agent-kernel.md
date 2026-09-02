# Phase 08: Agent Kernel

## Aggregate

`Agent` is the aggregate root for the agent-management subdomain.

## Lifecycle

`DRAFT → TESTING → APPROVED → ACTIVE → DEPRECATED → RETIRED`

Phase 08 implements the foundational lifecycle:

- `DRAFT` after creation.
- `ACTIVE` after `activate(...)`.
- `DEPRECATED` after `deactivate(...)`.
- `RETIRED` is a terminal state reserved for future phases.

## Capability model

- `Capability` extends `ValueObject`.
- Fields: `id`, `name`, `description`, `riskCategory`, `allowedTools`, `requiredPolicies`.
- Equality is value-based.
- Capabilities are registered on the agent and snapshotted when a version is published.

## Versioning

- `AgentVersion` is an immutable entity identified by a version string.
- `publishVersion(...)` captures the current capabilities, tools, policies, model/memory/knowledge policies, autonomy level, and evaluation policy.
- Re-publishing the same version returns an `AgentInvariantError`.

## Invariants

- At least one capability at creation.
- `autonomyLevelDefault` must be between 0 and 5.
- Activation/deactivation blocked on retired agents.

## Events

See `08-event-model.md` for agent events.
