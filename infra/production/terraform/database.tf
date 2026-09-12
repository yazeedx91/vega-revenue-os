resource "azurerm_private_dns_zone" "postgres" {
  name                = "privatelink.postgres.database.azure.com"
  resource_group_name = azurerm_resource_group.projectx.name
}

resource "azurerm_private_dns_zone_virtual_network_link" "postgres" {
  name                  = "postgres-link"
  resource_group_name   = azurerm_resource_group.projectx.name
  private_dns_zone_name = azurerm_private_dns_zone.postgres.name
  virtual_network_id    = azurerm_virtual_network.projectx.id
}

resource "random_password" "pg_admin" {
  length           = 24
  special          = true
  override_special = "!#%&*()-_=+[]{}<>?:,."
  min_special      = 4
}

resource "azurerm_postgresql_flexible_server" "projectx" {
  name                          = "${local.base_name}-pg"
  resource_group_name           = azurerm_resource_group.projectx.name
  location                      = var.location
  version                       = "16"
  administrator_login           = var.postgresql_admin_user
  administrator_password        = random_password.pg_admin.result
  storage_mb                    = 32768
  sku_name                      = local.is_test ? "B_Standard_B1ms" : "B_Standard_B2s"
  backup_retention_days         = 7
  geo_redundant_backup_enabled  = false
  public_network_access_enabled = false

  depends_on = [azurerm_private_dns_zone_virtual_network_link.postgres]
}

resource "azurerm_postgresql_flexible_server_configuration" "pgvector" {
  name      = "azure.extensions"
  server_id = azurerm_postgresql_flexible_server.projectx.id
  value     = "vector"
}

resource "azurerm_postgresql_flexible_server_database" "projectx" {
  name      = "projectx"
  server_id = azurerm_postgresql_flexible_server.projectx.id
  collation = "en_US.utf8"
  charset   = "utf8"
}

resource "azurerm_private_endpoint" "postgres" {
  name                = "${local.base_name}-pg-pe"
  location            = var.location
  resource_group_name = azurerm_resource_group.projectx.name
  subnet_id           = azurerm_subnet.endpoints.id

  private_service_connection {
    name                           = "postgres-psc"
    private_connection_resource_id = azurerm_postgresql_flexible_server.projectx.id
    is_manual_connection           = false
    subresource_names              = ["postgresqlServer"]
  }

  private_dns_zone_group {
    name                 = "postgres-dns"
    private_dns_zone_ids = [azurerm_private_dns_zone.postgres.id]
  }
}
