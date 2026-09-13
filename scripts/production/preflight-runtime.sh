#!/usr/bin/env bash
set -euo pipefail

# Production-shadow runtime preflight.
# This script validates the PRESENCE and structural shape of required
# runtime configuration references. It never reads or logs secret values.
#
# Required operator-supplied references (secret names / non-secret identifiers):
#   JWT_SIGNING_KEY_ACTIVE_REFERENCE
#   JWT_SIGNING_KEY_ACTIVE_KID
#   ENTRA_JWKS_SECRET_REFERENCE
#   ENTRA_ISSUER
#   ENTRA_CLIENT_ID
#   ENTRA_ALLOWED_TENANT_ID
#
# Optional (required only for live Graph inbound/outbound):
#   GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET_REFERENCE, GRAPH_WEBHOOK_CALLBACK_URL
#
# Optional embedding/LLM overrides:
#   OPENAI_EMBEDDING_SECRET_NAME, OPENAI_SECRET_NAME, OPENAI_DEFAULT_MODEL,
#   ANTHROPIC_SECRET_NAME, ANTHROPIC_DEFAULT_MODEL

TERRAFORM_DIR="${TERRAFORM_DIR:-infra/production/terraform}"

die() {
  echo "PREFLIGHT_FAILED: $*" >&2
  exit 1
}

require_var() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    die "Missing required runtime configuration: $name"
  fi
}

echo "=== ProjectX production-shadow runtime preflight ==="

require_var "JWT_SIGNING_KEY_ACTIVE_REFERENCE"
require_var "JWT_SIGNING_KEY_ACTIVE_KID"
require_var "ENTRA_JWKS_SECRET_REFERENCE"
require_var "ENTRA_ISSUER"
require_var "ENTRA_CLIENT_ID"
require_var "ENTRA_ALLOWED_TENANT_ID"

# Graph references must travel together when any are supplied.
if [[ -n "${GRAPH_TENANT_ID:-}" || -n "${GRAPH_CLIENT_ID:-}" || -n "${GRAPH_CLIENT_SECRET_REFERENCE:-}" ]]; then
  require_var "GRAPH_TENANT_ID"
  require_var "GRAPH_CLIENT_ID"
  require_var "GRAPH_CLIENT_SECRET_REFERENCE"
  require_var "GRAPH_WEBHOOK_CALLBACK_URL"
fi

# Validate issuer URL shape loosely without revealing it.
if [[ ! "$ENTRA_ISSUER" =~ ^https://login\.microsoftonline\.com/[^/]+/v2\.0$ ]]; then
  die "ENTRA_ISSUER must match https://login.microsoftonline.com/{tenant}/v2.0"
fi

# Validate that we are not accidentally enabling live send.
if [[ "${OUTREACH_LIVE_EMAIL_ENABLED:-false}" != "false" ]]; then
  die "OUTREACH_LIVE_EMAIL_ENABLED must be 'false' for shadow preflight"
fi

if [[ "${OUTREACH_MODE:-SHADOW}" != "SHADOW" ]]; then
  die "OUTREACH_MODE must be 'SHADOW' for shadow preflight"
fi

echo "Preflight passed. Required references are present."
echo ""
echo "Next, run the runtime-stage Terraform plan with the current deployed images:"
echo ""
cat <<EOF
terraform -chdir="$TERRAFORM_DIR" plan \
  -out="tfplan-runtime" \
  -var-file="uaenorth-test-shadow.tfvars" \
  -var="enable_migration_bootstrap=false" \
  -var="enable_application_runtime=true" \
  -var="database_url_secret_id=https://projectxtestmagicalmoray.vault.azure.net/secrets/database-url" \
  -var="temporal_api_key_secret_id=https://projectxtestmagicalmoray.vault.azure.net/secrets/TEMPORAL-API-KEY" \
  -var="jwt_signing_key_active_reference=\$JWT_SIGNING_KEY_ACTIVE_REFERENCE" \
  -var="jwt_signing_key_active_kid=\$JWT_SIGNING_KEY_ACTIVE_KID" \
  -var="entra_jwks_secret_reference=\$ENTRA_JWKS_SECRET_REFERENCE" \
  -var="entra_issuer=\$ENTRA_ISSUER" \
  -var="entra_client_id=\$ENTRA_CLIENT_ID" \
  -var="entra_allowed_tenant_id=\$ENTRA_ALLOWED_TENANT_ID" \
  -var="graph_tenant_id=\${GRAPH_TENANT_ID:-}" \
  -var="graph_client_id=\${GRAPH_CLIENT_ID:-}" \
  -var="graph_client_secret_reference=\${GRAPH_CLIENT_SECRET_REFERENCE:-}" \
  -var="graph_webhook_callback_url=\${GRAPH_WEBHOOK_CALLBACK_URL:-}" \
  -var="admin_api_key_secret_reference=\${ADMIN_API_KEY_SECRET_REFERENCE:-}" \
  -var="openai_embedding_secret_name=\${OPENAI_EMBEDDING_SECRET_NAME:-openai/embedding-api-key}" \
  -var="api_image=projectxtestmagicalmoray.azurecr.io/projectx-api@sha256:b7d8c3dc9ff78f9519f0f4f4662bf33639ad2e705690c1397255119d8045faee" \
  -var="worker_image=projectxtestmagicalmoray.azurecr.io/projectx-worker@sha256:6bb268048336daddba751a9efe5b89e3137bf24cf8d49af8327b4d4306d4e370"
EOF
