resource "azurerm_private_dns_zone" "vault" {
  name                = "privatelink.vaultcore.azure.net"
  resource_group_name = azurerm_resource_group.projectx.name
}

resource "azurerm_private_dns_zone_virtual_network_link" "vault" {
  name                  = "vault-link"
  resource_group_name   = azurerm_resource_group.projectx.name
  private_dns_zone_name = azurerm_private_dns_zone.vault.name
  virtual_network_id    = azurerm_virtual_network.projectx.id
}

resource "azurerm_key_vault" "projectx" {
  name                          = "${var.project_name}${var.environment}${replace(random_pet.suffix.id, "-", "")}"
  location                      = var.location
  resource_group_name           = azurerm_resource_group.projectx.name
  tenant_id                     = data.azurerm_client_config.current.tenant_id
  sku_name                      = "standard"
  soft_delete_retention_days    = 90
  purge_protection_enabled      = true
  rbac_authorization_enabled    = true
  public_network_access_enabled = false
}

data "azurerm_client_config" "current" {}

resource "azurerm_private_endpoint" "vault" {
  name                = "${local.base_name}-kv-pe"
  location            = var.location
  resource_group_name = azurerm_resource_group.projectx.name
  subnet_id           = azurerm_subnet.endpoints.id

  private_service_connection {
    name                           = "vault-psc"
    private_connection_resource_id = azurerm_key_vault.projectx.id
    is_manual_connection           = false
    subresource_names              = ["vault"]
  }

  private_dns_zone_group {
    name                 = "vault-dns"
    private_dns_zone_ids = [azurerm_private_dns_zone.vault.id]
  }
}
