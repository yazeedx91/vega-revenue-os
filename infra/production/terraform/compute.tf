resource "azurerm_log_analytics_workspace" "projectx" {
  name                = "${local.base_name}-law"
  location            = var.location
  resource_group_name = azurerm_resource_group.projectx.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
}

resource "azurerm_application_insights" "projectx" {
  name                = "${local.base_name}-appi"
  location            = var.location
  resource_group_name = azurerm_resource_group.projectx.name
  workspace_id        = azurerm_log_analytics_workspace.projectx.id
  application_type    = "Node.JS"
}

resource "azurerm_container_app_environment" "projectx" {
  name                       = "${local.base_name}-cae"
  location                   = var.location
  resource_group_name        = azurerm_resource_group.projectx.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.projectx.id
  infrastructure_subnet_id   = azurerm_subnet.aca.id
}

resource "azurerm_container_app" "api" {
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

  dynamic "custom_domain" {
    for_each = var.domain_name != "" ? [var.domain_name] : []
    content {
      certificate_binding_type = "SniEnabled"
      certificate_id           = null
      dns_suffix               = custom_domain.value
    }
  }

  template {
    container {
      name   = "api"
      image  = var.api_image
      cpu    = 1.0
      memory = "2Gi"

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
      env {
        name  = "TEMPORAL_NAMESPACE"
        value = "projectx"
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
    min_replicas = 2
    max_replicas = 6
  }

  depends_on = [azurerm_role_assignment.api_keyvault]
}

resource "azurerm_container_app" "worker" {
  name                         = "${local.base_name}-worker"
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
      cpu    = 1.0
      memory = "2Gi"

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
      env {
        name  = "TEMPORAL_NAMESPACE"
        value = "projectx"
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
    min_replicas = 2
    max_replicas = 6
  }

  depends_on = [azurerm_role_assignment.worker_keyvault]
}
