resource "random_pet" "suffix" {
  length = 2
}

locals {
  base_name = "${var.project_name}-${var.environment}-${random_pet.suffix.id}"
  is_test   = var.environment == "test"
}

resource "azurerm_resource_group" "projectx" {
  name     = local.base_name
  location = var.location
}

resource "azurerm_virtual_network" "projectx" {
  name                = "${local.base_name}-vnet"
  location            = var.location
  resource_group_name = azurerm_resource_group.projectx.name
  address_space       = [var.vnet_address_space]
}

resource "azurerm_subnet" "aca" {
  name                 = "snet-aca"
  resource_group_name  = azurerm_resource_group.projectx.name
  virtual_network_name = azurerm_virtual_network.projectx.name
  address_prefixes     = ["10.0.0.0/24"]
  delegation {
    name = "Microsoft.App/environments"
    service_delegation {
      name = "Microsoft.App/environments"
      actions = [
        "Microsoft.Network/virtualNetworks/subnets/join/action",
      ]
    }
  }
}

resource "azurerm_subnet" "endpoints" {
  name                 = "snet-endpoints"
  resource_group_name  = azurerm_resource_group.projectx.name
  virtual_network_name = azurerm_virtual_network.projectx.name
  address_prefixes     = ["10.0.1.0/24"]
}
