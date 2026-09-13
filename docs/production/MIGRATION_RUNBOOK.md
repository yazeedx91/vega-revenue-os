# ProjectX Production Migration Runbook

## Scope

Apply migrations `001` through `037` atomically to the private Azure PostgreSQL Flexible Server in `uaenorth`, then rotate the `projectx_app` runtime password and write the resulting `DATABASE_URL` into Azure Key Vault.

This runbook assumes the production shadow/test topology and the VNet-local migration Container Apps Job introduced in Phase 16.

## Pre-conditions

1. Foundation infrastructure is provisioned:
   - Resource group, VNet, subnets, private DNS zones
   - Azure Container Registry, Azure Key Vault, Container App Environment
   - PostgreSQL Flexible Server `projectx` database on a private endpoint
   - The migration bootstrap image is built and pushed to ACR by digest
2. The `enable_migration_bootstrap` Terraform variable is set to `true`.
3. The operator sets `migration_image` to the immutable digest of the `projectx-migration` image.
4. The `projectx-migration` Container Apps Job has **not** run before, or a re-run is intentionally approved.

## Safety Guard

- The migration bootstrap entrypoint refuses to run unless `PRODUCTION_BOOTSTRAP_APPROVED=true`.
- It refuses `localhost` / `127.0.0.1` / `::1` PostgreSQL targets.
- It does not use the fixed migration bootstrap password for runtime.
- The generated `projectx_app` password and `DATABASE_URL` are never logged.
- The GitHub Actions `production-deploy.yml` is disabled from automatically applying and migrating from `ubuntu-latest` runners that cannot reach private PostgreSQL/Key Vault.

## Bootstrap Sequence

1. Apply the Terraform foundation with migration bootstrap enabled:

   ```bash
   terraform plan \
     -var-file="uaenorth-test-shadow.tfvars" \
     -var="enable_migration_bootstrap=true" \
     -var="migration_image=<immutable-digest>" \
     -var="api_image=placeholder.invalid/projectx-api:plan-only" \
     -var="worker_image=placeholder.invalid/projectx-worker:plan-only"
   terraform apply "tfplan"
   ```

2. Start the one-shot migration job manually:

   ```bash
   az containerapp job start \
     --name "projectx-test-magical-moray-mig" \
     --resource-group "projectx-test-magical-moray"
   ```

3. Verify the job completes successfully. It will:
   - create `schema_migrations` if missing,
   - execute each unapplied `.sql` migration transactionally,
   - verify all `001` through `037` files are recorded,
   - verify `projectx_app` exists and is `LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`,
   - generate a strong random `projectx_app` password,
   - rotate `projectx_app` away from the fixed bootstrap password,
   - write `DATABASE_URL` to `https://projectxtestmagicalmoray.vault.azure.net/secrets/database-url`.

4. Confirm the `database-url` secret exists in Key Vault and the API/worker managed identities can read it.

5. Remove bootstrap privileges and re-plan the final configuration:

   ```bash
   terraform plan \
     -var-file="uaenorth-test-shadow.tfvars" \
     -var="enable_migration_bootstrap=false" \
     -var="database_url_secret_id=https://projectxtestmagicalmoray.vault.azure.net/secrets/database-url" \
     -var="api_image=<immutable-api-digest>" \
     -var="worker_image=<immutable-worker-digest>"
   terraform apply "tfplan"
   ```

6. After the final apply, the migration Container App Job, migration identity, and its ACR/Key Vault role assignments are removed, but the `database-url` Key Vault secret is retained. The API and worker receive `DATABASE_URL` through a Key Vault-backed secret reference.

## Verification

After bootstrap, connect from a VNet-local host (never from a GitHub runner) and confirm:

```sql
SELECT filename, applied_at FROM schema_migrations ORDER BY filename;
SELECT rolname, rolbypassrls, rolsuper, rolcreatedb, rolcreaterole, rolreplication
FROM pg_roles WHERE rolname = 'projectx_app';
```

## Phase 16 Test/Shadow Deployment Evidence

### Infrastructure drift fixes applied

- `infra/production/terraform/migration.tf`: `MIGRATIONS_DIR=/prod/migration/migrations` to match the image layout.
- `infra/production/terraform/migration.tf`: explicit `workload_profile_name = "Consumption"` on the migration job.
- `infra/production/terraform/database.tf`: `azure.extensions = "uuid-ossp,pgcrypto,vector"` allow-list.
- `infra/production/terraform/database.tf`: `lifecycle { ignore_changes = [zone] }` because Azure auto-assigns availability zone 3.
- `infra/production/terraform/network.tf`: explicit `actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]` on the ACA subnet delegation.
- `infra/production/terraform/compute.tf`: `lifecycle { ignore_changes = [infrastructure_resource_group_name, workload_profile] }` on the Container Apps Environment.
- `infra/production/terraform/compute.tf`: explicit `workload_profile_name = "Consumption"` on API and worker Container Apps.
- `infra/production/terraform/compute.tf`: explicit `registry` blocks and `depends_on` for API/worker AcrPull role assignments.

### Runtime image dependency fixes applied

- `pnpm-workspace.yaml`: removed override that forced `@nestjs/core` to v11 while the apps remain on v10.
- `apps/api/package.json`: added missing `@projectx/intelligence` workspace dependency.
- `apps/temporal-worker/package.json`: added missing `@projectx/specialist-agents` workspace dependency.
- `apps/api/Dockerfile` and `apps/temporal-worker/Dockerfile`: use `pnpm deploy --legacy` so pnpm v11 copies workspace packages into runtime images.

### Bootstrap execution

- Migration job: `projectx-test-magical-moray-mig-dwd31fi`
- Status: `Succeeded`
- Migrations applied: `38`
- Key Vault secret written: `database-url`

### Final runtime images

- API: `projectxtestmagicalmoray.azurecr.io/projectx-api@sha256:f024d48b4dce0524d4a99d5d95cd2c461a11cafe930fd267972805dc2bd52fe9`
- Worker: `projectxtestmagicalmoray.azurecr.io/projectx-worker@sha256:31f9d54a949193161bafb49c45ab1f7ca28df7c87605d1424fe3cb6c04d7ea47`

### Final runtime Terraform transition

```text
Plan: 0 to add, 2 to change, 0 to destroy
```

Only the API and worker Container App images were updated. No foundation resources were destroyed or replaced.

### Remaining operator blockers for full runtime start

1. **Embedding profile and secret**: exactly one `ACTIVE` row in `embedding.embedding_profiles` and a matching provider key in Key Vault (see `docs/production/EMBEDDING_PROFILE_BOOTSTRAP.md` and `docs/production/SECRET_INVENTORY.md`).
2. **Entra / Microsoft Graph secrets**: API startup requires valid Graph/Calendar/Dynamics credentials in Key Vault under the names in `docs/production/SECRET_INVENTORY.md`.
3. These are human/provider secrets; they cannot be generated or guessed by Devin. Once they are provisioned, run the final runtime plan again.

## Rollback

- The migration runner does not support automatic down-migration.
- If a migration fails, the transaction rolls back and the previous state remains intact.
- For recovery, restore from backup before the failed run.
- If the `database-url` secret is accidentally deleted, re-run the migration job to generate a new `projectx_app` password and rewrite the secret.
