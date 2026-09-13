# Operator Bootstrap Runbook

Use this runbook to create the runtime Key Vault secrets and the single ACTIVE
embedding profile **without opening Key Vault or PostgreSQL to the public
internet**. The workflow uses a short-lived operator bootstrap container
running inside the existing Azure Container Apps environment on the private
VNet.

## Preconditions

- You have Azure CLI access to the `ProjectX-Production` subscription.
- You can run Terraform from a machine that already has access to the remote
  backend.
- You are on a trusted network and device; secret values are entered
  interactively inside the container.

## Step 1 — Create the operator bootstrap container

Plan/apply Terraform with the operator bootstrap enabled. This creates a
single-replica Container App and a dedicated managed identity with only the
minimum permissions required.

```bash
terraform -chdir="infra/production/terraform" plan \
  -var-file="uaenorth-test-shadow.tfvars" \
  -var="enable_migration_bootstrap=false" \
  -var="enable_application_runtime=true" \
  -var="enable_operator_bootstrap=true" \
  -var="operator_bootstrap_image=projectxtestmagicalmoray.azurecr.io/projectx-operator-bootstrap@sha256:82ad427b6399c2f257ded9a9ee418d81989e1b048e8a3461ea311f58d4be86ce" \
  -out="tfplan-operator-bootstrap"

# Review the plan carefully. It must only ADD the operator bootstrap resources.
terraform -chdir="infra/production/terraform" apply tfplan-operator-bootstrap
```

Wait until the container is running:

```bash
az containerapp show \
  -g projectx-test-magical-moray \
  -n projectx-test-magical-moray-opbt \
  --query properties.latestRevisionName -o tsv
```

## Step 2 — Open an interactive shell inside the operator bootstrap container

```bash
az containerapp exec \
  -g projectx-test-magical-moray \
  -n projectx-test-magical-moray-opbt \
  --command /bin/sh
```

Everything you type inside this shell runs on the private VNet. Secret values
entered via `read -s` are not logged by the container.

## Step 3 — Create the runtime Key Vault secrets

Inside the container shell, run the following for each required secret. Values
are prompted interactively and are never echoed.

```bash
KEY_VAULT_NAME="projectxtestmagicalmoray"

# Repeat for each secret listed below.
set_secret() {
  local name="$1"
  local description="$2"
  echo "Enter value for $name ($description):"
  read -s value
  az keyvault secret set \
    --vault-name "$KEY_VAULT_NAME" \
    --name "$name" \
    --value "$value" \
    --tags purpose="$description" owner=operator \
    --output none
  echo "Set $name"
}

# Required
set_secret "jwt/active-signing-key" "Active JWT HMAC signing key (>=32 bytes)"
set_secret "entra/jwks" "Entra OIDC JWKS JSON array"
set_secret "openai/embedding-api-key" "OpenAI embedding API key"
set_secret "openai/api-key" "OpenAI LLM API key"

# Optional
set_secret "graph/client-secret" "Microsoft Graph application client secret"
set_secret "admin/api-key" "Operator admin API key"
```

## Step 4 — Insert exactly one ACTIVE embedding profile

Still inside the container shell, run the SQL from
`docs/production/EMBEDDING_PROFILE_BOOTSTRAP.md`. The PostgreSQL admin
connection URL is already injected as `POSTGRES_ADMIN_URL`.

```bash
psql "$POSTGRES_ADMIN_URL" <<'SQL'
UPDATE embedding.embedding_profiles
SET lifecycle = 'RETIRED'
WHERE lifecycle = 'ACTIVE';

INSERT INTO embedding.embedding_profiles (
  embedding_profile_id,
  provider_id,
  model_id,
  model_version,
  dimensions,
  distance_metric,
  vector_space,
  lifecycle,
  is_active
) VALUES (
  'openai-text-embedding-3-small-2024-01-25',
  'openai',
  'text-embedding-3-small',
  '2024-01-25',
  1536,
  'cosine',
  'openai:text-embedding-3-small:2024-01-25:1536:cosine',
  'ACTIVE',
  true
)
ON CONFLICT (embedding_profile_id) DO UPDATE SET
  provider_id = EXCLUDED.provider_id,
  model_id = EXCLUDED.model_id,
  model_version = EXCLUDED.model_version,
  dimensions = EXCLUDED.dimensions,
  distance_metric = EXCLUDED.distance_metric,
  vector_space = EXCLUDED.vector_space,
  lifecycle = 'ACTIVE',
  is_active = true;

SELECT embedding_profile_id, provider_id, model_id, model_version, dimensions,
       distance_metric, vector_space, lifecycle, is_active
FROM embedding.embedding_profiles
WHERE is_active = true;
SQL
```

The final `SELECT` must return **exactly one** row. If it returns zero or more
than one row, stop and investigate before proceeding.

## Step 5 — Exit the container and remove the bootstrap infrastructure

Exit the container shell:

```bash
exit
```

Then plan/apply Terraform with the operator bootstrap disabled to remove the
container, identity, and role assignments:

```bash
terraform -chdir="infra/production/terraform" plan \
  -var-file="uaenorth-test-shadow.tfvars" \
  -var="enable_migration_bootstrap=false" \
  -var="enable_application_runtime=true" \
  -var="enable_operator_bootstrap=false" \
  -out="tfplan-operator-bootstrap-destroy"

terraform -chdir="infra/production/terraform" apply tfplan-operator-bootstrap-destroy
```

The `postgres-admin-url` secret created by the bootstrap module will also be
removed. Runtime components continue to use the separately managed
`database-url` secret.

## Step 6 — Continue with the runtime Terraform plan

Now that the secrets and ACTIVE embedding profile exist, provide the real
non-secret runtime identifiers and plan the runtime stage:

```bash
terraform -chdir="infra/production/terraform" plan \
  -var-file="uaenorth-test-shadow.tfvars" \
  -var="enable_migration_bootstrap=false" \
  -var="enable_application_runtime=true" \
  -var="api_image=projectxtestmagicalmoray.azurecr.io/projectx-api@sha256:b7d8c3dc9ff78f9519f0f4f4662bf33639ad2e705690c1397255119d8045faee" \
  -var="worker_image=projectxtestmagicalmoray.azurecr.io/projectx-worker@sha256:6bb268048336daddba751a9efe5b89e3137bf24cf8d49af8327b4d4306d4e370" \
  -var="database_url_secret_id=https://projectxtestmagicalmoray.vault.azure.net/secrets/database-url" \
  -var="temporal_api_key_secret_id=https://projectxtestmagicalmoray.vault.azure.net/secrets/TEMPORAL-API-KEY" \
  -var="jwt_signing_key_active_reference=jwt/active-signing-key" \
  -var="jwt_signing_key_active_kid=<REAL_KID>" \
  -var="entra_jwks_secret_reference=entra/jwks" \
  -var="entra_issuer=https://login.microsoftonline.com/<REAL_TENANT>/v2.0" \
  -var="entra_client_id=<REAL_CLIENT_ID>" \
  -var="entra_allowed_tenant_id=<REAL_ALLOWED_TENANT_ID>" \
  -var="openai_embedding_secret_name=openai/embedding-api-key" \
  -var="openai_secret_name=openai/api-key"
```

Expected shape: `0 to add, 2 to change, 0 to destroy`. Apply only after review.

## Step 7 — Verify runtime health

After apply:

```bash
# API health
curl https://<api-fqdn>/healthz
curl https://<api-fqdn>/readyz

# Worker health (via Container App console/logs)
az containerapp logs show \
  -g projectx-test-magical-moray \
  -n projectx-test-magical-moray-wrk
```

Look for:

- API returns `200` from `/healthz` and `/readyz`.
- Worker logs contain `EMBEDDING_RUNTIME_READY` and no
  `NoActiveEmbeddingProfileStartupError`.

## Security notes

- No secret value appears in Terraform variables, `.tfvars`, source, or state.
- The `postgres-admin-url` secret value is generated from the existing
  Terraform-managed password; it is only accessible to the bootstrap identity.
- The bootstrap container has no public ingress and is removed after use.
- The bootstrap identity is separate from API/worker/migration identities and is
  removed when the bootstrap module is disabled.
