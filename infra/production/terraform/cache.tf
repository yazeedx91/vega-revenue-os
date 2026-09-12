resource "azurerm_private_dns_zone" "redis" {
  name                = "privatelink.redis.azure.net"
  resource_group_name = azurerm_resource_group.projectx.name
}

resource "azurerm_private_dns_zone_virtual_network_link" "redis" {
  name                  = "redis-link"
  resource_group_name   = azurerm_resource_group.projectx.name
  private_dns_zone_name = azurerm_private_dns_zone.redis.name
  virtual_network_id    = azurerm_virtual_network.projectx.id
}

resource "azurerm_managed_redis" "projectx" {
  name                  = "${local.base_name}-redis"
  location              = var.location
  resource_group_name   = azurerm_resource_group.projectx.name
  sku_name              = local.is_test ? "Balanced_B0" : "Balanced_B3"
  public_network_access = "Disabled"

  default_database {
    access_keys_authentication_enabled = true
  }
}

resource "azurerm_private_endpoint" "redis" {
  name                = "${local.base_name}-redis-pe"
  location            = var.location
  resource_group_name = azurerm_resource_group.projectx.name
  subnet_id           = azurerm_subnet.endpoints.id

  private_service_connection {
    name                           = "redis-psc"
    private_connection_resource_id = azurerm_managed_redis.projectx.id
    is_manual_connection           = false
    subresource_names              = ["redisEnterprise"]
  }

  private_dns_zone_group {
    name                 = "redis-dns"
    private_dns_zone_ids = [azurerm_private_dns_zone.redis.id]
  }
}
