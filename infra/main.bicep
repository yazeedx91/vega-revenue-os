targetScope = 'resourceGroup'

@allowed(['dev', 'staging', 'prod'])
@description('Deployment environment.')
param environment string

@description('Azure region for resources.')
param location string

@description('Project name prefix used in resource naming.')
param projectName string

// Phase 07 foundation: parameter declarations only; no resources are deployed.
