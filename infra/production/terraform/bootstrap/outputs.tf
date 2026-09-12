output "resource_group_name" {
  description = "Resource group for Terraform state"
  value       = azurerm_resource_group.tfstate.name
}

output "storage_account_name" {
  description = "Globally unique storage account for Terraform state"
  value       = azurerm_storage_account.tfstate.name
}

output "container_name" {
  description = "Blob container for Terraform state"
  value       = azurerm_storage_container.tfstate.name
}
