output "api_fqdn" {
  description = "API Container App FQDN"
  value       = azurerm_container_app.api.ingress[0].fqdn
}

output "key_vault_uri" {
  description = "Key Vault URI"
  value       = azurerm_key_vault.projectx.vault_uri
}

output "postgresql_fqdn" {
  description = "PostgreSQL Flexible Server FQDN"
  value       = azurerm_postgresql_flexible_server.projectx.fqdn
}

output "redis_hostname" {
  description = "Redis hostname"
  value       = azurerm_redis_cache.projectx.hostname
}

output "redis_ssl_port" {
  description = "Redis SSL port"
  value       = azurerm_redis_cache.projectx.ssl_port
}

output "application_insights_name" {
  description = "Application Insights resource name"
  value       = azurerm_application_insights.projectx.name
}

output "api_identity_client_id" {
  description = "API user-assigned managed identity client ID"
  value       = azurerm_user_assigned_identity.api.client_id
}

output "worker_identity_client_id" {
  description = "Worker user-assigned managed identity client ID"
  value       = azurerm_user_assigned_identity.worker.client_id
}

output "container_registry_login_server" {
  description = "ACR login server"
  value       = azurerm_container_registry.projectx.login_server
}
