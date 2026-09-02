# P0-3 Kill Switch Runbook

## Purpose
The live-email kill switch prevents any actual external provider send when the environment is not explicitly configured for a controlled, allowlist-only send window.

## Environment variable
- `OUTREACH_LIVE_EMAIL_ENABLED`
  - `false` (default): all provider `send` calls return a simulated/accepted result or are denied by the safety gate.
  - `true`: live sends are permitted only when `OUTREACH_MODE=ALLOWLIST_ONLY`.

## Steps to stop live sends immediately

1. Set `OUTREACH_LIVE_EMAIL_ENABLED=false` in the workload environment.
2. Restart the `temporal-worker` and `api` processes with a graceful `SIGTERM`:
   - Wait for the `OUTREACH_GRACEFUL_DRAIN_MS` / `API_GRACEFUL_DRAIN_MS` (default 30s).
3. Verify:
   - `api` `/readyz` returns `200`.
   - `temporal-worker` `/readyz` returns `200`.
   - No new `MessageExecution` reaches `PROVIDER_ATTEMPTED` or `PROVIDER_ACCEPTED` while in live mode.

## Steps to resume a controlled live window

1. Confirm `OUTREACH_MODE=ALLOWLIST_ONLY` and the recipient allowlist is populated.
2. Set `OUTREACH_LIVE_EMAIL_ENABLED=true`.
3. Restart the worker and API.
4. Send one execution to an allowlisted recipient and verify `providerMessageId` and `internetMessageId` are recorded in `outreach.message_executions`.
5. Keep the window narrow; revert `OUTREACH_LIVE_EMAIL_ENABLED=false` after the controlled window.

## Audit
Every live send is recorded in `audit_log` with `action = 'OUTREACH_EMAIL_SEND'` and `result`.
