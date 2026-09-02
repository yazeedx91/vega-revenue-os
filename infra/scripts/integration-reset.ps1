#!/usr/bin/env pwsh
# Stop the Phase 14.7c integration environment and remove all persisted data.
# Usage: infra/scripts/integration-reset.ps1

$ErrorActionPreference = 'Stop'
$composeFile = Join-Path $PSScriptRoot '..' 'docker-compose.integration.yml' | Resolve-Path

Write-Host "Stopping integration environment and removing volumes ..."
docker compose -f "$composeFile" down -v

Write-Host "Restarting integration environment ..."
& (Join-Path $PSScriptRoot 'integration-up.ps1')

Write-Host "Integration environment has been reset."
