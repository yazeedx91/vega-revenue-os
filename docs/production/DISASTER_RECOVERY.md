# ProjectX Disaster Recovery

## 1. PostgreSQL

### Backup

- Use Azure Backup for PostgreSQL Flexible Server or `pg_dump` with `pg_dumpall` roles.
- Backups must be encrypted at rest and copied to a secondary region.
- Test restore quarterly on a non-production target.

### Restore

1. Create a new Flexible Server from backup or `pg_restore`.
2. Re-run `scripts/production/bootstrap-migrations.sh` to verify `schema_migrations`.
3. Verify RLS and `FORCE RLS` on all tables.
4. Update `DATABASE_URL` in Key Vault.
5. Restart API and worker.

### RTO/RPO Targets

- RPO: <= 1 hour with geo-redundant backup.
- RTO: <= 30 minutes for compute, <= 2 hours for full DB restore.

## 2. Redis

### Loss Scenario

Redis is used for transient state: rate limits, idempotency windows, locks. Loss is recoverable from PostgreSQL source of truth.

### Recovery

1. Reprovision Azure Cache for Redis.
2. Update `REDIS_HOST` / key in Key Vault.
3. Restart API and worker.

## 3. Temporal

### Temporal Cloud

- Temporal Cloud provides its own persistence and history.
- Export/mirror namespaces if required by compliance.

### Self-hosted Temporal

- Restore from the same PostgreSQL backup used for application data.
- Reconnect workers to the restored frontend.

## 4. API / Worker Replacement

1. Build new image.
2. Deploy via the production pipeline or manually to Container App.
3. Verify readiness and `/ready`.
4. Route traffic via Application Gateway.

## 5. Key Vault Key Retention

> **CRITICAL:** Historical recipient encryption and HMAC keys must not be destroyed while durable artifacts or fingerprints still reference them.

- Keep `projectx/contact-channel/encryption-keys/{version}` and `projectx/contact-channel/hmac-keys/{version}` until all records using those versions are migrated or removed.
- Use Key Vault soft delete and purge protection.
- Document key version usage in `SECRET_INVENTORY.md`.

## 6. Application Rollback

1. Re-deploy the previous immutable image tag.
2. Keep the database and Key Vault unchanged if the rollback is code-only.
3. If a migration was rolled forward, do not roll back application code until DB is compatible.

## 7. Provider Outage

- LLM/embedding provider outage: missions retry with backoff; queue grows.
- Microsoft Graph outage: outbound sends fail with `DELIVERY_UNKNOWN`; reconciliation handles resend.
- Dynamics outage: intelligence reads fail closed.
- Key Vault outage: all secret reads fail; API/worker should degrade, not expose secrets.

## 8. Data Sovereignty

- Keep backups in the same sovereign region as production.
- Do not copy PII to lower environments.
