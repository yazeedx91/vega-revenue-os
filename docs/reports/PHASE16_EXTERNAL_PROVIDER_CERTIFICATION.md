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
| Dynamics 365 / Dataverse | Not started | Not started | Dataverse environment + Entra app required |

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

## Remaining Blockers

1. **OpenAI billing credits** must be added to run live embedding and LLM calls and finish certification.
2. **Dynamics 365 / Dataverse** requires:
   - A real Dataverse organization URL.
   - A dedicated Entra app registration with admin consent.
   - `DYNAMICS_AUTHORITIES_JSON` configured on the API.

## Next Steps

1. Add OpenAI credits and rerun the live embedding/LLM smoke tests.
2. Obtain the Dynamics 365 / Dataverse credentials and continue with that provider certification.
