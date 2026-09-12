# Production Smoke Test Runbook

## Scope

Validate that the deployed ProjectX control plane is reachable, secured, and able to use private data stores without performing uncontrolled outreach.

## Script

Use `scripts/production/smoke-test.sh` or run the equivalent checks manually.

## Checks

### 1. API Health

```bash
curl -sf https://<api-domain>/health || exit 1
```

Expected: `200` with body `{ "status": "ok" }` or equivalent.

### 2. API Readiness

```bash
curl -sf https://<api-domain>/ready || exit 1
```

Expected: `200` only when DB, Redis, and Temporal are reachable.

### 3. Database / RLS

```bash
pnpm exec tsx scripts/production/rls-check.ts
```

Expected: all tenant/workspace tables have `relrowsecurity` and `relforcerowlevelsecurity` enabled.

### 4. Redis

```bash
redis-cli -h <redis-host> -p 6380 --tls PING
```

Expected: `PONG`.

### 5. Temporal

```bash
temporal operator cluster health --address <temporal-address> --namespace projectx
```

Expected: `SERVING`.

### 6. Worker Readiness

Verify the worker Container App reports `Ready` and the health endpoint returns `200`.

### 7. Key Vault

Run a non-destructive secret existence check from inside the worker:

```bash
curl -sf https://<api-domain>/health/secrets
```

Expected: `200` and no secret values in the response.

### 8. Embedding Readiness

Verify `EMBEDDING_RUNTIME_READY` log line and no `NoEmbeddingProviderError`.

### 9. LLM Readiness

Run a controlled non-sensitive `/operator/smoke-llm` or similar authenticated endpoint with a fixed harmless prompt. No PII.

### 10. Graph Authentication

Verify `msal` token acquisition succeeds without sending mail.

### 11. Calendar Authentication

Perform a read-only `/calendar/availability` smoke check.

### 12. Dynamics Authentication

Perform a read-only bounded account query.

### 13. Webhook Endpoint

```bash
curl -X POST https://<api-domain>/webhooks/graph \
  -H "Content-Type: application/json" \
  -d '{"clientState":"wrong"}'
```

Expected: `401` or `403`; no resource mutation.

## Outcome

All checks `PASS` before enabling any live-sending flag. If any check fails, the deployment is not ready.
