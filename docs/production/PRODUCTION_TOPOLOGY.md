# ProjectX Production Topology

## Logical Services

| Service | Responsibility | Reachability |
|---------|----------------|--------------|
| ProjectX API | HTTP/HTTPS API, admin, operator, webhook ingress | Public over HTTPS (custom domain + WAF) |
| Temporal Worker | Polls Temporal task queues, executes activities, sends side effects | No public ingress; outbound only |
| PostgreSQL | Application state, RLS, pgvector, Temporal persistence | Private endpoint inside VNet only |
| Redis | Rate limiting, idempotency, locks, caching | Private endpoint inside VNet only |
| Temporal Server | Workflow orchestration (self-hosted or Temporal Cloud) | Private network; Web UI limited to authorized operators |
| Azure Key Vault | Secrets, recipient crypto keys, LLM/Graph credentials | Private endpoint or trusted identity; no public secret access |
| Azure Container Registry | Immutable API + worker images | Private endpoint or restricted public; pull via managed identity |
| Azure Monitor / App Insights | Logs, metrics, tracing | Internal operational access only |

## Network Flows

1. Operator / Customer → HTTPS → Application Gateway / WAF → API Container App
2. API / Worker → Managed Identity → Key Vault (secrets)
3. API / Worker → Private Endpoint → PostgreSQL
4. API / Worker → Private Endpoint → Redis
5. Worker → Private/mTLS → Temporal Frontend
6. API / Worker → Outbound HTTPS → Microsoft Graph, LLM provider, embedding provider
7. Microsoft Graph → HTTPS POST → Webhook endpoint → API
8. Container App → Managed Identity → ACR (pull)

## Compute Model

- API: Azure Container App with external ingress, custom domain, TLS managed cert.
- Worker: Azure Container App with no ingress; scales with KEDA or ACA scale rules.
- Temporal: Recommended to use Temporal Cloud with mTLS (simplest). For self-hosting, use an AKS cluster or Azure VMs with Temporal Helm; the Terraform module exposes endpoint variables for either.

## External Integrations

| Provider | Direction | Notes |
|----------|-----------|-------|
| Azure Key Vault | Outbound | Workload / user-assigned managed identity |
| Microsoft Graph / Exchange | Outbound | MSAL client credential; mailbox identity |
| Calendar | Outbound | Same Graph client, calendar RW permission |
| Dynamics 365 | Outbound | GET-only; Dataverse API; organization URL |
| LLM | Outbound | Azure OpenAI or OpenAI; key from Key Vault |
| Embedding | Outbound | Azure OpenAI / OpenAI / custom; exact active profile |
| Webhooks | Inbound | HTTPS callback URL with clientState verification |

## Live-Send Safety Default

- `LIVE_SEND_ENABLED=false` at deployment.
- Suppression, allowlist, approval, rate limits, budget, and reconciliation active.
- Worker begins in **shadow mode**; no external outbound send until explicitly authorized.
