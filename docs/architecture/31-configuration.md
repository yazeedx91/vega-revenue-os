# Configuration Architecture

## Configuration Categories

| Category | Examples | Owner |
|---|---|---|
| System configuration | Feature flags, global rate limits, provider endpoints | Platform Administrator |
| Tenant configuration | Autonomy level, integrations, brand settings, policies | Customer Administrator |
| User configuration | Preferences, defaults, signatures | End User |
| Agent configuration | Model routing, capability enablement, retries | Platform / Tenant Admin |
| Mission configuration | Objectives, budget, timeframe, ICP, channels | Revenue Manager |
| Policy configuration | Autonomy policies, approval rules, compliance rules | Compliance Admin |
| Integration configuration | CRM connections, email providers, calendar providers | Customer Administrator |
| Secrets | API keys, tokens, connection strings | Secrets Manager |

## Configuration Delivery

- Runtime configuration from configuration store or environment variables.
- Tenant configuration loaded from operational database per request/job.
- Secrets injected from secrets manager; never in source control.
- Feature flags from feature flag service.
- Caching of tenant config with TTL and invalidation.

## Configuration Hierarchy

1. System defaults
2. Tenant configuration
3. Mission/configuration-specific override
4. User override (where applicable)

Lower layers override higher layers unless restricted.

## Change Management

- Configuration changes are versioned and audited.
- Tenant config changes emit events where needed.
- Breaking changes require migration path.
- Emergency configuration changes can be applied by platform admin with audit.

## Security

- Sensitive configuration encrypted at rest and in transit.
- Access controlled by RBAC.
- Secrets never logged.
- Configuration endpoints require appropriate roles.

## Validation

- Configuration validated against schema.
- Cross-field consistency checked (e.g., autonomy level vs allowed actions).
- Tenant configuration cannot override system security minimums.
