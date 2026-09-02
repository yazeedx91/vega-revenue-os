#!/usr/bin/env pwsh
# Wait for the Phase 14.7c integration services to become ready.
# Usage: infra/scripts/integration-wait.ps1

$ErrorActionPreference = 'Stop'
$composeFile = Join-Path $PSScriptRoot '..' 'docker-compose.integration.yml' | Resolve-Path

function Wait-ForCommand {
    param(
        [Parameter(Mandatory)] [string] $Name,
        [Parameter(Mandatory)] [scriptblock] $Command,
        [int] $TimeoutSeconds = 60,
        [int] $IntervalSeconds = 2
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $global:LASTEXITCODE = 0
        try {
            $null = & $Command
            if ($global:LASTEXITCODE -eq 0) {
                Write-Host "  $Name is ready."
                return
            }
        } catch {
            # native command failures land here; continue waiting
        }
        Write-Host "  Waiting for $Name ..."
        Start-Sleep -Seconds $IntervalSeconds
    }
    throw "Timed out waiting for $Name after ${TimeoutSeconds}s."
}

Wait-ForCommand -Name 'PostgreSQL' -Command {
    docker compose -f "$composeFile" exec -T postgres pg_isready -U projectx -d projectx | Out-Null
}

Wait-ForCommand -Name 'Redis' -Command {
    $output = docker compose -f "$composeFile" exec -T redis redis-cli ping
    if ($output -notmatch 'PONG') { throw 'Redis not ready' }
}

Wait-ForCommand -Name 'Temporal frontend' -TimeoutSeconds 120 -Command {
    docker compose -f "$composeFile" exec -T temporal sh -c 'nc -z $(hostname -i) 7233' | Out-Null
}

Write-Host "All integration services are ready."
