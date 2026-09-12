resource "azurerm_user_assigned_identity" "migration" {
  count = var.enable_migration_bootstrap ? 1 : 0

  name                = "${local.base_name}-migration"
  location            = var.location
  resource_group_name = azurerm_resource_group.projectx.name
}

resource "azurerm_role_assignment" "migration_acr_pull" {
  count = var.enable_migration_bootstrap ? 1 : 0

  scope                = azurerm_container_registry.projectx.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.migration[0].principal_id
}

resource "azurerm_role_assignment" "migration_keyvault" {
  count = var.enable_migration_bootstrap ? 1 : 0

  # Key Vault Secrets Officer is the narrowest built-in role that allows the
  # bootstrap to both create the database-url secret (which does not yet exist)
  # and later write a new version to it. The identity is removed after bootstrap.
  scope                = azurerm_key_vault.projectx.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = azurerm_user_assigned_identity.migration[0].principal_id
}

resource "azurerm_container_app_job" "migration" {
  count = var.enable_migration_bootstrap ? 1 : 0

  name                         = "${local.base_name}-mig"
  location                     = var.location
  resource_group_name          = azurerm_resource_group.projectx.name
  container_app_environment_id = azurerm_container_app_environment.projectx.id

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.migration[0].id]
  }

  manual_trigger_config {
    parallelism              = 1
    replica_completion_count = 1
  }

  replica_timeout_in_seconds = 1800
  replica_retry_limit        = 0

  template {
    container {
      name   = "migration"
      image  = var.migration_image
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "PRODUCTION_BOOTSTRAP_APPROVED"
        value = "true"
      }
      env {
        name  = "MIGRATIONS_DIR"
        value = "/migrations"
      }
      env {
        name  = "PGHOST"
        value = azurerm_postgresql_flexible_server.projectx.fqdn
      }
      env {
        name  = "PGPORT"
        value = "5432"
      }
      env {
        name  = "PGADMINUSER"
        value = var.postgresql_admin_user
      }
      env {
        name  = "PGDATABASE"
        value = "projectx"
      }
      env {
        name  = "AZURE_KEY_VAULT_URL"
        value = azurerm_key_vault.projectx.vault_uri
      }
      env {
        name  = "AZURE_CLIENT_ID"
        value = azurerm_user_assigned_identity.migration[0].client_id
      }
      env {
        name        = "PGADMINPASSWORD"
        secret_name = "pg-admin-password"
      }
    }
  }

  secret {
    name  = "pg-admin-password"
    value = random_password.pg_admin.result
  }

  registry {
    server   = azurerm_container_registry.projectx.login_server
    identity = azurerm_user_assigned_identity.migration[0].id
  }

  depends_on = [
    azurerm_role_assignment.migration_acr_pull,
    azurerm_role_assignment.migration_keyvault,
  ]
}
