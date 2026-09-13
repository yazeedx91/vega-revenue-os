resource "azurerm_log_analytics_workspace" "projectx" {
  name                = "${local.base_name}-law"
  location            = var.location
  resource_group_name = azurerm_resource_group.projectx.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  daily_quota_gb      = 1
}

resource "azurerm_application_insights" "projectx" {
  name                 = "${local.base_name}-appi"
  location             = var.location
  resource_group_name  = azurerm_resource_group.projectx.name
  workspace_id         = azurerm_log_analytics_workspace.projectx.id
  application_type     = "Node.JS"
  daily_data_cap_in_gb = 1
  sampling_percentage  = 25
}

resource "azurerm_container_app_environment" "projectx" {
  name                       = "${local.base_name}-cae"
  location                   = var.location
  resource_group_name        = azurerm_resource_group.projectx.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.projectx.id
  infrastructure_subnet_id   = azurerm_subnet.aca.id

  lifecycle {
    ignore_changes = [
      infrastructure_resource_group_name,
      workload_profile,
    ]
  }
}

resource "azurerm_container_app" "api" {
  count                        = var.enable_application_runtime ? 1 : 0
  name                         = "${local.base_name}-api"
  container_app_environment_id = azurerm_container_app_environment.projectx.id
  resource_group_name          = azurerm_resource_group.projectx.name
  revision_mode                = "Single"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.api.id]
  }

  ingress {
    external_enabled = true
    target_port      = 3000
    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  template {
    container {
      name   = "api"
      image  = var.api_image
      cpu    = local.is_test ? 0.25 : 1.0
      memory = local.is_test ? "0.5Gi" : "2Gi"

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "PORT"
        value = "3000"
      }
      env {
        name  = "AZURE_KEY_VAULT_URL"
        value = azurerm_key_vault.projectx.vault_uri
      }
      env {
        name  = "AZURE_CLIENT_ID"
        value = azurerm_user_assigned_identity.api.client_id
      }
      dynamic "env" {
        for_each = var.database_url_secret_id != "" ? [1] : []
        content {
          name        = "DATABASE_URL"
          secret_name = "database-url"
        }
      }
      env {
        name  = "TEMPORAL_ADDRESS"
        value = var.temporal_address
      }
      env {
        name  = "TEMPORAL_NAMESPACE"
        value = var.temporal_namespace
      }
      dynamic "env" {
        for_each = var.temporal_api_key_secret_id != "" ? [1] : []
        content {
          name        = "TEMPORAL_API_KEY"
          secret_name = "temporal-api-key"
        }
      }
      env {
        name  = "OUTREACH_LIVE_EMAIL_ENABLED"
        value = "false"
      }
      env {
        name  = "OUTREACH_MODE"
        value = "SHADOW"
      }
      env {
        name  = "APPLICATIONINSIGHTS_CONNECTION_STRING"
        value = azurerm_application_insights.projectx.connection_string
      }
    }
    min_replicas = local.is_test ? 0 : 2
    max_replicas = local.is_test ? 2 : 6
  }

  dynamic "secret" {
    for_each = var.temporal_api_key_secret_id != "" ? [1] : []
    content {
      name                = "temporal-api-key"
      key_vault_secret_id = var.temporal_api_key_secret_id
      identity            = azurerm_user_assigned_identity.api.id
    }
  }

  dynamic "secret" {
    for_each = var.database_url_secret_id != "" ? [1] : []
    content {
      name                = "database-url"
      key_vault_secret_id = var.database_url_secret_id
      identity            = azurerm_user_assigned_identity.api.id
    }
  }

  registry {
    server   = azurerm_container_registry.projectx.login_server
    identity = azurerm_user_assigned_identity.api.id
  }

  depends_on = [azurerm_role_assignment.api_keyvault, azurerm_role_assignment.api_acr_pull]
}

resource "azurerm_container_app" "worker" {
  count                        = var.enable_application_runtime ? 1 : 0
  name                         = "${local.base_name}-wrk"
  container_app_environment_id = azurerm_container_app_environment.projectx.id
  resource_group_name          = azurerm_resource_group.projectx.name
  revision_mode                = "Single"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.worker.id]
  }

  template {
    container {
      name   = "worker"
      image  = var.worker_image
      cpu    = local.is_test ? 0.25 : 1.0
      memory = local.is_test ? "0.5Gi" : "2Gi"

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "AZURE_KEY_VAULT_URL"
        value = azurerm_key_vault.projectx.vault_uri
      }
      env {
        name  = "AZURE_CLIENT_ID"
        value = azurerm_user_assigned_identity.worker.client_id
      }
      dynamic "env" {
        for_each = var.database_url_secret_id != "" ? [1] : []
        content {
          name        = "DATABASE_URL"
          secret_name = "database-url"
        }
      }
      env {
        name  = "TEMPORAL_ADDRESS"
        value = var.temporal_address
      }
      env {
        name  = "TEMPORAL_NAMESPACE"
        value = var.temporal_namespace
      }
      dynamic "env" {
        for_each = var.temporal_api_key_secret_id != "" ? [1] : []
        content {
          name        = "TEMPORAL_API_KEY"
          secret_name = "temporal-api-key"
        }
      }
      env {
        name  = "OUTREACH_WORKER_HEALTH_PORT"
        value = "3001"
      }
      env {
        name  = "OUTREACH_LIVE_EMAIL_ENABLED"
        value = "false"
      }
      env {
        name  = "OUTREACH_MODE"
        value = "SHADOW"
      }
      env {
        name  = "APPLICATIONINSIGHTS_CONNECTION_STRING"
        value = azurerm_application_insights.projectx.connection_string
      }
    }
    min_replicas = 1
    max_replicas = 2
  }

  dynamic "secret" {
    for_each = var.temporal_api_key_secret_id != "" ? [1] : []
    content {
      name                = "temporal-api-key"
      key_vault_secret_id = var.temporal_api_key_secret_id
      identity            = azurerm_user_assigned_identity.worker.id
    }
  }

  dynamic "secret" {
    for_each = var.database_url_secret_id != "" ? [1] : []
    content {
      name                = "database-url"
      key_vault_secret_id = var.database_url_secret_id
      identity            = azurerm_user_assigned_identity.worker.id
    }
  }

  registry {
    server   = azurerm_container_registry.projectx.login_server
    identity = azurerm_user_assigned_identity.worker.id
  }

  # To scale the worker to zero after a test, run:
  # az containerapp update -g <resource-group> -n <worker-name> --min-replicas 0 --max-replicas 0

  depends_on = [azurerm_role_assignment.worker_keyvault, azurerm_role_assignment.worker_acr_pull]
}
