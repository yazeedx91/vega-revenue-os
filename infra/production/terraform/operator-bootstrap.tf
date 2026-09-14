# -----------------------------------------------------------------------------
# Optional operator bootstrap container app.
#
# Purpose:
#   Provide a short-lived, VNet-local compute surface so an authorized operator
#   can create runtime Key Vault secrets and insert the ACTIVE embedding profile
#   without opening Key Vault or PostgreSQL to the public internet.
#
# Usage:
#   1. Plan/apply with enable_operator_bootstrap=true (creates the app + identity
#      and grants the minimum Key Vault / PostgreSQL admin permissions).
#   2. Operator runs: az containerapp exec -n <app-name> -g <rg> --command /bin/sh
#   3. Inside the container, run the commands documented in
#      docs/production/OPERATOR_BOOTSTRAP_RUNBOOK.md.
#   4. Plan/apply with enable_operator_bootstrap=false to remove the app and
#      its role assignments.
#
# Security properties:
#   - Runs on the existing ACA VNet, so it reaches Key Vault/Postgres private
#     endpoints only.
#   - Uses a dedicated user-assigned identity, separate from API/worker.
#   - Identity receives only AcrPull, Key Vault Secrets Officer, and read on
#     the postgres-admin-url secret; it does NOT share API/worker privileges.
#   - Secrets are entered interactively by the operator inside the exec shell.
#   - The container image contains no secrets and no bootstrap automation that
#     could be triggered accidentally.
# -----------------------------------------------------------------------------

variable "enable_operator_bootstrap" {
  type        = bool
  description = "If true, create the operator bootstrap container app. Use only for one-shot secret/profile bootstrap, then set false."
  default     = false
}

variable "operator_bootstrap_image" {
  type        = string
  description = "Operator bootstrap utility container image (immutable digest only)"
  default     = ""

  validation {
    condition     = !var.enable_operator_bootstrap || (var.operator_bootstrap_image != "" && can(regex("@sha256:[a-f0-9]{64}$", var.operator_bootstrap_image)))
    error_message = "operator_bootstrap_image is required and must be an immutable digest reference (@sha256:<64-hex>) when enable_operator_bootstrap is true"
  }
}

resource "azurerm_user_assigned_identity" "operator_bootstrap" {
  count               = var.enable_operator_bootstrap ? 1 : 0
  name                = "${local.base_name}-opbt"
  location            = var.location
  resource_group_name = azurerm_resource_group.projectx.name
}

resource "azurerm_role_assignment" "operator_bootstrap_acr_pull" {
  count                = var.enable_operator_bootstrap ? 1 : 0
  scope                = azurerm_container_registry.projectx.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.operator_bootstrap[0].principal_id
}

# Grants the operator bootstrap identity the ability to create runtime secrets.
resource "azurerm_role_assignment" "operator_bootstrap_keyvault_officer" {
  count                = var.enable_operator_bootstrap ? 1 : 0
  scope                = azurerm_key_vault.projectx.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = azurerm_user_assigned_identity.operator_bootstrap[0].principal_id
}

resource "azurerm_container_app" "operator_bootstrap" {
  count                        = var.enable_operator_bootstrap ? 1 : 0
  name                         = "${local.base_name}-opbt"
  container_app_environment_id = azurerm_container_app_environment.projectx.id
  resource_group_name          = azurerm_resource_group.projectx.name
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.operator_bootstrap[0].id]
  }

  template {
    container {
      name   = "operator-bootstrap"
      image  = var.operator_bootstrap_image
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name        = "POSTGRES_ADMIN_PASSWORD"
        secret_name = "postgres-admin-password"
      }

      env {
        name  = "POSTGRES_ADMIN_USER"
        value = var.postgresql_admin_user
      }

      env {
        name  = "POSTGRES_HOST"
        value = azurerm_postgresql_flexible_server.projectx.fqdn
      }

      env {
        name  = "POSTGRES_DB"
        value = azurerm_postgresql_flexible_server_database.projectx.name
      }

      env {
        name  = "KEY_VAULT_NAME"
        value = azurerm_key_vault.projectx.name
      }

      env {
        name  = "AZURE_CLIENT_ID"
        value = azurerm_user_assigned_identity.operator_bootstrap[0].client_id
      }
    }
    min_replicas = 1
    max_replicas = 1
  }

  secret {
    name  = "postgres-admin-password"
    value = random_password.pg_admin.result
  }

  registry {
    server   = azurerm_container_registry.projectx.login_server
    identity = azurerm_user_assigned_identity.operator_bootstrap[0].id
  }

  depends_on = [
    azurerm_role_assignment.operator_bootstrap_acr_pull,
    azurerm_role_assignment.operator_bootstrap_keyvault_officer,
  ]
}
