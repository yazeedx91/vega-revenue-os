terraform {
  required_version = ">= 1.5.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.66.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }

  # Bootstrap is a one-time, local-state operation.
  # After the storage account exists, the main ProjectX stack uses it as an azurerm backend.
}

provider "azurerm" {
  features {}
}
