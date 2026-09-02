# P0-3 Secret Rotation Runbook

## Scope
Rotate secrets used by the outreach pipeline: Azure Key Vault client credentials, the `GRAPH_CLIENT_SECRET_REFERENCE`, webhook validation secrets (`webhookSecretReference`), and any other key-vault-backed references.

## Production constraint
- Raw secrets are forbidden in production. `EnvironmentSecretsProvider` is rejected by `validateControlledCommunicationConfig` when `NODE_ENV=production`.
- All secret material must be referenced through Azure Key Vault (`AZURE_KEY_VAULT_URL`) and `*REFERENCE` environment variables.

## Steps

1. **Stage the new secret in Azure Key Vault**
   - Create a new version of the secret or a new secret name.
   - Do **not** delete the old secret until the pipeline has been verified with the new reference.

2. **Update the environment variable to the new reference**
   - For example, change `GRAPH_CLIENT_SECRET_REFERENCE` to the new Key Vault secret name/version.
   - Keep `AZURE_KEY_VAULT_URL` unchanged.

3. **Update the deployment/secret store**
   - Apply the new environment variable to the workload (Kubernetes secret, container app, etc.).

4. **Restart the worker and API gracefully**
   - Send `SIGTERM` to the `temporal-worker` and the `api` process.
   - Wait for the configured `OUTREACH_GRACEFUL_DRAIN_MS` / `API_GRACEFUL_DRAIN_MS` (default 30s) drain timeout.
   - Verify the worker reconnects to Temporal and the API `/readyz` returns `200`.

5. **Smoke test**
   - In `OUTREACH_LIVE_EMAIL_ENABLED=false` mode, submit an execution through the API or a test workflow.
   - Confirm the Graph token provider resolves the new reference and the `SendSafetyGate` returns `ALLOW` for an allowlisted recipient.

6. **Decommission the old secret version**
   - Only after 24 hours of stable operation and no stuck reconciliations.

## Rollback
If a new reference fails, restore the previous `*REFERENCE` value. The previous Key Vault version must still exist for an immediate rollback.
