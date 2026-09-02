#!/usr/bin/env pwsh
# Start the Phase 14.7c integration environment.
# Usage: infra/scripts/integration-up.ps1

$ErrorActionPreference = 'Stop'
$composeFile = Join-Path $PSScriptRoot '..' 'docker-compose.integration.yml' | Resolve-Path

Write-Host "Starting integration environment from $composeFile ..."
docker compose -f "$composeFile" up -d

Write-Host "Waiting for services to become healthy ..."
& (Join-Path $PSScriptRoot 'integration-wait.ps1')

Write-Host "Integration environment is up."
