# P0-3 Backup / Restore and RLS Verification Runbook

## Purpose
PostgreSQL backups and restores for the outreach system must preserve Row-Level Security (RLS) policy assignments and the `projectx_security_owner` role ownership. A restore that silently reverts a SECURITY DEFINER function to `postgres` owner or loses `search_path` configuration can break tenant isolation.

## Pre-requisites
- A PostgreSQL superuser is only used for restore; application pools must connect as the unprivileged application role.
- The `projectx_security_owner` role and the `outreach` schema exist on the target before data is restored.

## Backup verification steps

1. Take a logical backup of the `outreach` schema:
   ```bash
   pg_dump --schema-only --schema=outreach --file=outreach_schema.sql
   pg_dump --data-only --schema=outreach --file=outreach_data.sql
   ```

2. Verify the dump contains:
   - `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`
   - `CREATE POLICY ...` statements for `outreach.*` tables.
   - `CREATE OR REPLACE FUNCTION resolve_inbound_mailbox(...) SECURITY DEFINER` and `SET search_path = 'outreach';`

3. If the dump omits ownership, add explicit ownership restore commands:
   ```sql
   ALTER FUNCTION outreach.resolve_inbound_mailbox OWNER TO projectx_security_owner;
   ```

## Restore verification steps

1. Restore schema and data into a fresh database or staging copy.
2. Re-run the post-restore checks in `tests/e2e/phase14/tenant-isolation-security.spec.ts`:
   - The `proconfig` of `resolve_inbound_mailbox` contains unquoted `search_path=outreach`.
   - `proowner` is `projectx_security_owner`.
   - A non-superuser application role cannot read rows from a different `app.current_tenant`.
3. Verify the `projectx_security_owner` role exists and is not a superuser.

## Go/no-go
Do not promote a restored database to production until the tenant-isolation tests pass.
