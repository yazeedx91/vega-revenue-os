#!/usr/bin/env pwsh
# Stop the Phase 14.7c integration environment (preserves volumes).
# Usage: infra/scripts/integration-down.ps1

$ErrorActionPreference = 'Stop'
$composeFile = Join-Path $PSScriptRoot '..' 'docker-compose.integration.yml' | Resolve-Path

Write-Host "Stopping integration environment ..."
docker compose -f "$composeFile" down

Write-Host "Integration environment is down."
