# ProjectX Migration Runbook

## Scope

Apply migrations `001` through `037` atomically to an approved production or staging PostgreSQL instance.

## Pre-conditions

1. The migration runner is `infra/database/migrations/run.ts`.
2. Each migration is executed inside a transaction and recorded in `schema_migrations`.
3. Migrations must run exactly once from one approved control plane (CI/CD job or operator shell).
4. The application must not race to migrate at startup.

## Safety Guard

`scripts/production/bootstrap-migrations.sh` refuses to run against:

- `localhost` / `127.0.0.1`
- missing `DATABASE_URL`
- a `DATABASE_URL` that does not resolve to the expected target
- any host unless `PRODUCTION_MIGRATION_TARGET_APPROVED=true`

## Operator Steps

1. Set `DATABASE_URL` from Key Vault.
2. Export `PRODUCTION_MIGRATION_TARGET_APPROVED=true`.
3. Verify `PGHOST` matches the approved target.
4. Run:
   ```bash
   ./scripts/production/bootstrap-migrations.sh
   ```
5. Verify `schema_migrations` contains files `001` through `037` in order.
6. Verify RLS is enabled:
   ```sql
   SELECT n.nspname, c.relname, c.relrowsecurity, c.relforcerowlevelsecurity
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema');
   ```
7. Verify the application role has `NOBYPASSRLS`:
   ```sql
   SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = 'projectx_app';
   ```

## Rollback

- The migration runner does not support automatic down-migration.
- If a migration fails, the transaction is rolled back and the previous state is intact.
- For recovery from a bad migration, restore from backup before the failed run.
