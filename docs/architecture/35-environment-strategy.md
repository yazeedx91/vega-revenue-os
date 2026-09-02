# Environment Strategy

## Environments

| Environment | Purpose | Data |
|---|---|---|
| Development | Local/remote developer work | Synthetic, non-production |
| CI | Automated builds and tests | Ephemeral synthetic data |
| Test | Automated integration/E2E tests | Synthetic data, no PII |
| Staging | Pre-production validation | Anonymized production-like |
| Production | Live tenant workloads | Real tenant data |

## Environment Rules

- Production credentials never used in non-production.
- Production data not copied to lower environments without anonymization.
- External provider sandbox accounts used in non-production.
- Feature flags control which capabilities are active per environment.
- Configuration managed separately per environment.

## Promotion Path

1. Feature branch tested in CI.
2. Merged to main, deployed to Test.
3. Integration and contract tests pass.
4. Deployed to Staging with production-like data.
5. Final validation and canary.
6. Deployed to Production.

## Environment-Specific Configuration

- Database connection strings
- Event bus endpoints
- External provider endpoints and sandbox credentials
- Rate limits
- Log levels
- Feature flags
- Secrets references

## Isolation

- Separate infrastructure per environment where possible.
- Tenant IDs unique per environment.
- No cross-environment event traffic.
- Secrets isolated per environment.
