# Environments

## Environment Strategy

| Environment | Purpose | Data Isolation |
|---|---|---|
| Local | Developer development | Local/seeds only |
| Development | Shared, unstable | Synthetic data |
| CI | Ephemeral test environment | Generated per run |
| Test | Stable integration testing | Anonymized test data |
| Staging | Pre-production mirror | Synthetic or anonymized |
| Production | Live | Real tenant data |

## Configuration

- Environment-specific parameter files in Bicep.
- Application config via Azure App Configuration or environment variables.
- Secrets in per-environment Key Vault.
- Feature flags via Azure App Configuration.

## Data Isolation

- Separate resource groups or subscriptions per environment.
- Production data never copied to lower environments.
- Anonymization process for staging if needed.
- Separate Key Vault per environment.

## Secrets

- No production secrets in dev/test.
- Lower environments use separate credentials.
- CI uses short-lived federated credentials.

## Feature Flags

- Azure App Configuration feature flags.
- Flags scoped per environment.
- Percentage/tenant rollout in staging.

## Deployment Flow

```
Local → Dev → CI → Test → Staging → Production
```

- Automated to staging.
- Manual approval to production.
- Smoke tests in each environment.

## Environments Diagram

```mermaid
graph LR
    Local --> Dev
    Dev --> CI
    CI --> Test
    Test --> Staging
    Staging --> Production
```
