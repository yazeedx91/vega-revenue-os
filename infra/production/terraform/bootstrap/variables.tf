variable "location" {
  type        = string
  description = "Azure region for the Terraform state resources"
  default     = "uaenorth"
}

variable "terraform_principal_ip" {
  type        = string
  description = "Public IP of the Terraform runner used for storage account network access"
  default     = ""
}
