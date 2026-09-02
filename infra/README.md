# Infrastructure as Code

This directory contains Bicep modules and parameter files for Azure resources.

Phase 07 foundation commits parameter declarations only. No deployment jobs are enabled and no Azure resources are created.

## Conventions

- `modules/` — reusable Bicep modules (to be added in later phases).
- `environments/` — per-environment `.bicepparam` files (dev, staging, prod).
- `main.bicep` — top-level parameter declarations and orchestration stub.
