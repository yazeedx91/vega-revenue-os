resource "azurerm_user_assigned_identity" "api" {
  name                = "${local.base_name}-api"
  location            = var.location
  resource_group_name = azurerm_resource_group.projectx.name
}

resource "azurerm_user_assigned_identity" "worker" {
  name                = "${local.base_name}-worker"
  location            = var.location
  resource_group_name = azurerm_resource_group.projectx.name
}

resource "azurerm_role_assignment" "api_keyvault" {
  scope                = azurerm_key_vault.projectx.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.api.principal_id
}

resource "azurerm_role_assignment" "worker_keyvault" {
  scope                = azurerm_key_vault.projectx.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.worker.principal_id
}

resource "azurerm_container_registry" "projectx" {
  # Test/shadow uses Basic ACR with the public endpoint enabled as an explicit cost exception.
  # Private ACR endpoints require the Premium SKU and are not justified for the $200 test budget.
  # Admin access is disabled; managed identities are used for pull via AcrPull.
  name                = "${var.project_name}${var.environment}${random_pet.suffix.id}"
  location            = var.location
  resource_group_name = azurerm_resource_group.projectx.name
  sku                 = local.is_test ? "Basic" : "Premium"
  admin_enabled       = false
}

resource "azurerm_role_assignment" "api_acr_pull" {
  scope                = azurerm_container_registry.projectx.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.api.principal_id
}

resource "azurerm_role_assignment" "worker_acr_pull" {
  scope                = azurerm_container_registry.projectx.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.worker.principal_id
}
