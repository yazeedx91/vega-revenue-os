#Requires -Version 7.2
<#
.SYNOPSIS
  Insert operator-owned runtime secrets into the ProjectX Key Vault.

.DESCRIPTION
  This script accepts secret values interactively (Read-Host -AsSecureString)
  and writes them to Azure Key Vault. It NEVER logs or echoes the secret
  values. It is intended to be run from a VNet-local context (jump host,
  self-hosted runner, or VPN) because the Key Vault has public access
  disabled.

  Required secrets before runtime SHADOW apply:
    - jwt/active-signing-key
    - entra/jwks
    - openai/embedding-api-key
    - openai/api-key

  Optional secrets:
    - graph/client-secret
    - admin/api-key

.PARAMETER VaultName
  Name of the Azure Key Vault (e.g. projectxtestmagicalmoray).

.PARAMETER SkipOptional
  If set, skip the optional Graph/admin secrets.

.EXAMPLE
  .\scripts\production\set-operator-secrets.ps1 -VaultName projectxtestmagicalmoray
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)]
  [string] $VaultName,

  [switch] $SkipOptional
)

$ErrorActionPreference = 'Stop'

function Set-OperatorSecret {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Name,

    [Parameter(Mandatory = $true)]
    [string] $Description
  )

  $secure = Read-Host "Enter value for secret '$Name' ($Description)" -AsSecureString
  $plain = ConvertFrom-SecureString -SecureString $secure -AsPlainText

  if ([string]::IsNullOrWhiteSpace($plain)) {
    Write-Warning "Skipping '$Name' because an empty value was provided."
    return
  }

  if ($PSCmdlet.ShouldProcess("$VaultName/$Name", 'Set Key Vault secret')) {
    # Write the value to a temporary file so it is NOT exposed on the az
    # command line, then remove the file as soon as the CLI returns.
    $tempFile = [System.IO.Path]::GetTempFileName()
    try {
      [System.IO.File]::WriteAllText($tempFile, $plain)

      az keyvault secret set `
        --vault-name $VaultName `
        --name $Name `
        --file $tempFile `
        --tags purpose=$Description owner=operator rotation-date=$(Get-Date -Format 'yyyy-MM-dd') `
        --output none

      Write-Host "Secret '$Name' set in Key Vault '$VaultName'." -ForegroundColor Green
    }
    finally {
      if (Test-Path $tempFile) {
        [System.IO.File]::Delete($tempFile)
      }
    }
  }
}

Write-Host "Operator secret bootstrap for ProjectX runtime" -ForegroundColor Cyan
Write-Host "Key Vault: $VaultName"
Write-Host "Secret values are entered interactively and are NOT logged." -ForegroundColor Yellow
Write-Host ""

# Required secrets
Set-OperatorSecret -Name 'jwt/active-signing-key' -Description 'Active JWT HMAC signing key (>=32 bytes)'
Set-OperatorSecret -Name 'entra/jwks' -Description 'Entra OIDC JWKS JSON array'
Set-OperatorSecret -Name 'openai/embedding-api-key' -Description 'OpenAI embedding API key'
Set-OperatorSecret -Name 'openai/api-key' -Description 'OpenAI LLM API key'

if (-not $SkipOptional) {
  Set-OperatorSecret -Name 'graph/client-secret' -Description 'Microsoft Graph application client secret'
  Set-OperatorSecret -Name 'admin/api-key' -Description 'Operator admin API key'
}

Write-Host ""
Write-Host "Operator secret bootstrap complete." -ForegroundColor Green
Write-Host "Next steps:"
Write-Host "  1. Insert exactly one ACTIVE embedding profile using docs/production/EMBEDDING_PROFILE_BOOTSTRAP.md"
Write-Host "  2. Run the runtime-stage Terraform plan with real identity/JWT/Entra values and apply after operator review."
