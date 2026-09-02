# Phase 14 — Milestone 4: Microsoft Graph Email Adapter Configuration Contract

Names only — **no real values are present in this repository or in any code path**. All secrets must be sourced through the existing `ISecretsProvider` abstraction (`EnvironmentSecretsProvider` for local dev, `AzureKeyVaultSecretsProvider` in real deployments) — never hardcoded, never logged, never embedded in domain/application state, workflow state, or audit events.

## Secrets (via `ISecretsProvider`)

| Secret name | Used by | Purpose |
|---|---|---|
| `GRAPH_TENANT_ID` | `MsalTokenProvider` | Entra ID tenant ID for the client-credentials authority URL. |
| `GRAPH_CLIENT_ID` | `MsalTokenProvider` | Entra ID application (client) ID. |
| `GRAPH_CLIENT_SECRET` | `MsalTokenProvider` | Entra ID application client secret. |

## Environment variables (non-secret configuration)

| Variable | Default | Purpose |
|---|---|---|
| `GRAPH_SENDER_ADDRESS` | — (required to construct `GraphEmailProvider`) | The mailbox the adapter sends from; used to build the `/users/{sender}/sendMail` Graph path. |
| `OUTREACH_LIVE_EMAIL_ENABLED` | `false` (any value other than the exact string `'true'` is treated as disabled) | **Runtime kill-switch.** Checked immediately before the Graph HTTP send. Does not bypass, replace, or duplicate any `SendSafetyGate` control (allowlist, suppression, approval, rate limit, budget, idempotency) — those remain independently mandatory. |
| `GRAPH_SEND_TIMEOUT_MS` | `30000` | `FetchGraphHttpClient` request timeout; a timeout is classified `RETRYABLE`. |

## Wiring (not performed in this milestone)

`GraphEmailProvider` is fully implemented and tested but is **not** registered into any production composition root. There is currently no `apps/temporal-worker` (or other) composition root that wires any `IEmailProvider` (including `StubEmailProvider`) into `IOutreachProviderRegistry` at all — confirmed by inspection, so there is no existing wiring path this milestone needed to avoid touching.

To construct the adapter (for a future, ARB-approved wiring milestone):

```ts
import { MsalTokenProvider } from '@projectx/infrastructure';
import { GraphEmailProvider, FetchGraphHttpClient } from '@projectx/outreach';

const tokenProvider = new MsalTokenProvider({
  tenantId: await secretsProvider.getSecret('GRAPH_TENANT_ID'),
  clientId: await secretsProvider.getSecret('GRAPH_CLIENT_ID'),
  clientSecret: await secretsProvider.getSecret('GRAPH_CLIENT_SECRET'),
});

const provider = new GraphEmailProvider({
  tokenProvider,
  httpClient: new FetchGraphHttpClient(),
  senderAddress: process.env.GRAPH_SENDER_ADDRESS!,
  // isLiveEmailEnabled defaults to reading process.env.OUTREACH_LIVE_EMAIL_ENABLED === 'true'
});
```

Enabling `OUTREACH_LIVE_EMAIL_ENABLED=true` remains subject to the existing ARB gate and the allowlist-only / first-send-approval rollout — it is **not** authorized as part of this milestone.
