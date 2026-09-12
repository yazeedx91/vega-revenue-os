# ProjectX Operations Runbook

## Dashboards

| Dashboard | Purpose | Key Metrics |
|-----------|---------|-------------|
| API | HTTP health | `5xx` rate, latency p95, request rate |
| Worker | Task execution | workflow failures, activity failures, task queue lag |
| PostgreSQL | DB health | connections, CPU, storage, slow queries |
| Redis | Cache/locks | memory, evictions, command rate |
| Temporal | Workflow visibility | pending workflows, started, completed, failed |
| Providers | External adapters | auth failures, retries, DELIVERY_UNKNOWN count |
| Cost | LLM/embedding | tokens, requests, estimated cost |

## Alerts

| Alert | Condition | Action |
|-------|-----------|--------|
| API unavailable | health endpoint fails for 2 minutes | check Container App, DNS, certificate |
| Worker unavailable | task queue lag > 5 minutes | check worker pods, Temporal, DB |
| Database unavailable | `/ready` DB check fails | check PostgreSQL, VNet, firewall |
| Redis unavailable | PING fails | check Redis, VNet, DNS |
| Temporal unavailable | cluster health not `SERVING` | check Temporal endpoint, mTLS, network |
| Migration failure | `schema_migrations` out of sync | stop deployment; restore from backup if needed |
| External provider auth failure | Graph/LLM/Dynamics auth error rate > threshold | rotate key, verify credentials in Key Vault |
| DELIVERY_UNKNOWN accumulation | > 10 in 5 minutes | investigate Graph reconciliation, rate limits |
| Repeated failed missions | same workflow failure > 3x | inspect worker logs, PII-free payload |
| Live-send emergency stop | `OUTREACH_LIVE_EMAIL_ENABLED` must remain `false` until authorized | any `true` change triggers alert |

## Health Endpoints

- `GET /health` — liveness
- `GET /ready` — DB, Redis, Temporal, Key Vault readiness
- `GET /health/secrets` — secret provider is reachable (no values returned)

## Reconciliation

- Monitor `DELIVERY_UNKNOWN` executions.
- Investigate Graph notifications that do not correlate.
- Do not auto-resend; require operator or policy approval.

## Emergency Live-Send Shutdown

1. Set `OUTREACH_LIVE_EMAIL_ENABLED=false` in Key Vault / Container App environment.
2. Restart all worker replicas.
3. Confirm logs show `LIVE_SEND_DISABLED`.
4. Halt any in-flight missions if necessary.

## Telemetry Rules

- All logs and metrics must be JSON-structured.
- No plaintext recipient, email, phone, token, or raw chain-of-thought in logs.
- Redact or hash identifiers before export.
