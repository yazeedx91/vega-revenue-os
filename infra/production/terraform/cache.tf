resource "azurerm_private_dns_zone" "redis" {
  name                = "privatelink.redis.cache.windows.net"
  resource_group_name = azurerm_resource_group.projectx.name
}

resource "azurerm_private_dns_zone_virtual_network_link" "redis" {
  name                  = "redis-link"
  resource_group_name   = azurerm_resource_group.projectx.name
  private_dns_zone_name = azurerm_private_dns_zone.redis.name
  virtual_network_id    = azurerm_virtual_network.projectx.id
}

resource "azurerm_redis_cache" "projectx" {
  name                          = "${local.base_name}-redis"
  location                      = var.location
  resource_group_name           = azurerm_resource_group.projectx.name
  capacity                      = 1
  family                        = "P"
  sku_name                      = "Premium"
  enable_non_ssl_port           = false
  minimum_tls_version           = "1.2"
  public_network_access_enabled = false

  redis_configuration {
    maxmemory_reserved = 2
    maxmemory_delta    = 2
    maxmemory_policy   = "allkeys-lru"
  }
}

resource "azurerm_private_endpoint" "redis" {
  name                = "${local.base_name}-redis-pe"
  location            = var.location
  resource_group_name = azurerm_resource_group.projectx.name
  subnet_id           = azurerm_subnet.endpoints.id

  private_service_connection {
    name                           = "redis-psc"
    private_connection_resource_id = azurerm_redis_cache.projectx.id
    is_manual_connection           = false
    subresource_names              = ["redisCache"]
  }

  private_dns_zone_group {
    name                 = "redis-dns"
    private_dns_zone_ids = [azurerm_private_dns_zone.redis.id]
  }
}
