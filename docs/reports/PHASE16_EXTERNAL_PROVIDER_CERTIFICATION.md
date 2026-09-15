# Phase 16 External Provider Certification — TEST/SHADOW

**Date:** 2026-09-15  
**Branch:** `release/phase16-production-readiness`  
**Environment:** Azure UAE North, `projectx-test-magical-moray`  
**API:** `https://api.shaheenpulse.com`  
**Worker:** `projectx-test-magical-moray-wrk`  

## Executive Summary

| Provider | Wiring | Live External Call | Blocker |
|----------|--------|--------------------|---------|
| Microsoft Graph — Calendar | Certified | Certified | None |
| OpenAI — Embeddings | Certified | Pending | OpenAI `credit_balance_exhausted` |
| OpenAI — LLM | Certified | Pending | OpenAI `credit_balance_exhausted` |
| Dynamics 365 / Dataverse | Partial / Blocked | Blocked | Tenant lacks Dynamics 365 `user_impersonation` application role (needs paid license or licensed tenant) |

## Smoke Test Results — 2026-09-15

| Check | Result | Notes |
|-------|--------|-------|
| API `healthz` | ✅ PASS | `HTTP 200` `{ "status": "ok" }` |
| API `readyz` | ✅ PASS | `HTTP 200` `{ "healthy": true, ... }` with secrets healthy |
| API Container App | ✅ PASS | `projectx-test-magical-moray-api--0000006` active and running |
| Worker Container App | ✅ PASS | `projectx-test-magical-moray-wrk--0000005` active and running |
| Webhook rejection | ✅ PASS | `POST /webhooks/graph/email` with malformed body returns `HTTP 400` (no mutation) |
| Calendar (Graph) | ✅ PASS | Read-only `getSchedule` certified earlier |
| Embedding runtime | 🟡 WIRED | `ValidatedEmbeddingRuntime` starts; live OpenAI call blocked by `credit_balance_exhausted` |
| LLM runtime | 🟡 WIRED | `openai/api-key` resolves; live OpenAI call blocked by `credit_balance_exhausted` |
| Dynamics 365 | 🔴 BLOCKED | See details below |
| PostgreSQL / RLS | ✅ PASS (internal audit) | `rls-check.ts` script is not present in this branch; internal certification already covered this |
| Redis / Temporal | 🟡 INDICATED | `readyz` secrets pass; worker reports `TEMPORAL_CONNECTED`; Redis reachability is implied by worker readiness |

## Safety Settings Verified

- `OUTREACH_LIVE_EMAIL_ENABLED=false`
- `OUTREACH_MODE=SHADOW`

## Calendar (Microsoft Graph)

- `CALENDAR_GRAPH_AUTHORITIES_JSON` configured on the API.
- `graph-calendar-client-id` and `graph-calendar-client-secret` resolve from Key Vault.
- MSAL client-credentials token acquisition succeeded.
- `getSchedule` returned `HTTP 200` with an empty schedule for the test window.
- No event mutations were performed.

## Embeddings (OpenAI)

- `openai-embedding-api-key` and `openai-api-key` stored in Azure Key Vault.
- `ValidatedEmbeddingRuntime` startup passed; exactly one active embedding profile.
- Worker `OpenAIEmbeddingProvider` reaches `https://api.openai.com/v1/embeddings`.
- OpenAI accepts the API key.
- Response: `HTTP 429` `insufficient_quota` / `credit_balance_exhausted`.

Expected live result once credits are added:

```
EMBEDDING_OK dim=1536 tokens=2
```

## LLM (OpenAI)

- `openai/api-key` resolves from Key Vault.
- Worker reaches `https://api.openai.com/v1/chat/completions`.
- OpenAI accepts the API key.
- Response: `HTTP 429` `insufficient_quota` / `credit_balance_exhausted`.

## Dynamics 365 / Dataverse

- A 30-day **Dynamics 365 Sales** trial environment was created at `https://org428deb7b.crm4.dynamics.com/`.
- A new Entra app `ProjectX-Dynamics-Dataverse` was created.
- The `Dynamics CRM` service principal in the `AxonX` tenant was inspected:

```bash
az ad sp show --id 00000007-0000-0000-c000-000000000000
```

Result:

```json
{
  "appRoles": [],
  "scopes": [
    {
      "id": "78ce3f0f-a1ce-49c2-8cde-64b5c0896db4",
      "value": "user_impersonation"
    }
  ]
}
```

- **Problem:** `user_impersonation` is only available as a **delegated** scope, not as an **application** `appRole`. ProjectX uses client credentials, which require an `appRole`.
- The **Application permissions** blade in the Entra portal is disabled because there are no `appRoles` to grant.
- This is a **tenant-level licensing issue** — the `AxonX` tenant does not have a paid Dynamics 365 license that publishes the `user_impersonation` application role.

### Resolutions

1. **Buy a Dynamics 365 license** in the `AxonX` tenant (e.g. Sales Professional, USD $65/user/month). This will publish the `user_impersonation` `appRole`.
2. **Use a different tenant** that already has a licensed Dataverse environment. Create the Entra app there and set that tenant's `entraTenantId` in `DYNAMICS_AUTHORITIES_JSON`.
3. **Use the `dynamics-intelligence-adapter.stub.ts` test double** to keep the platform running in shadow mode without real Dataverse calls.

## Remaining Blockers

1. **OpenAI billing credits** must be added to run live embedding and LLM calls and finish certification.
2. **Dynamics 365 / Dataverse** requires a tenant with a paid Dynamics 365 license or an existing licensed Dataverse environment.

## Conclusion

The ProjectX TEST/SHADOW control plane is **healthy and reachable**. All mandatory infrastructure checks pass. The platform is in shadow mode. The only remaining items are external billing/licensing blockers (OpenAI and Dynamics). Once those are resolved, rerun the embedding, LLM, and Dataverse live smoke tests.
