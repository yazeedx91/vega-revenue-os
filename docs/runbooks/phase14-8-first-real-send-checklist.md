# Phase 14.8 — First Controlled Real Email / Reply Operator Checklist

**Purpose:** Execute exactly one real Microsoft Graph outbound email to a single allowlisted test recipient, receive its reply, capture evidence, and disable live email again.

**Safety rules:**
- One allowlisted test recipient only.
- `OUTREACH_LIVE_EMAIL_ENABLED` stays `false` until the APPROVE step, then is reset to `false` at DISABLE.
- No mass/bulk outreach.
- No removal of the allowlist or approval mechanisms.
- No Dynamics 365 write-back.
- No autonomous broad sending.

---

## PRE-FLIGHT — Confirm readiness before touching any live switch

| # | Action | Evidence to capture |
|---|--------|---------------------|
| 1.1 | Open this checklist and the execution report side-by-side. | Screenshot / signed copy. |
| 1.2 | Confirm the target environment is an isolated/approved Entra test tenant. | Tenant name, directory ID. |
| 1.3 | Confirm `OUTREACH_LIVE_EMAIL_ENABLED=false` in worker and API environments. | Env var dump / config screenshot. |
| 1.4 | Confirm `OUTREACH_MODE=ALLOWLIST_ONLY`. | Env var dump / config screenshot. |
| 1.5 | Verify `pnpm -r test` passes in the deployed code version. | Test output summary. |
| 1.6 | Verify `pnpm audit` reports 0 findings. | Audit JSON / CLI output. |
| 1.7 | Confirm Snyk scans are clean or documented as exceptions. | `snyk-code-report.json`, `snyk-deps-report.json`. |
| 1.8 | Schedule a human approver and a rollback operator for the test window. | Names, contact methods. |

---

## CONFIGURE — Provision and wire the test tenant

| # | Action | Command / Reference | Evidence |
|---|--------|---------------------|----------|
| 2.1 | Provision or select the isolated Entra test tenant. | `docs/implementation/phase14-8-entra-test-tenant-setup.md` | Tenant ID, tenant name. |
| 2.2 | Register the application with no redirect URIs and no public flows. | Azure portal / Entra admin center | Application (client) ID. |
| 2.3 | Add **only** `Mail.Send` (Application permission) and grant admin consent. | Azure portal / Entra admin center | API permissions screenshot. |
| 2.4 | Create a short-lived client secret or certificate and place it in the approved secret store. | Key Vault / CI secrets | Secret store reference ID. |
| 2.5 | Configure the shared sender mailbox and note its SMTP address. | Exchange admin center | `GRAPH_SENDER_ADDRESS`. |
| 2.6 | Deploy/update worker and API with the Graph settings. | CI/CD pipeline | Deployment log. |
| 2.7 | Set `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET_REFERENCE` (or `GRAPH_CLIENT_SECRET`), `GRAPH_SENDER_ADDRESS`. | Secret store / env | Redacted config screenshot. |
| 2.8 | Restrict Conditional Access to expected outbound IP ranges (recommended). | Entra Conditional Access | Policy ID. |

---

## VERIFY — Validate credentials and safety state

| # | Action | Command | Evidence |
|---|--------|---------|----------|
| 3.1 | Run the token validation script in the target environment. | `node scripts/validation/graph-token-test.js` | Output showing `Mail.Send permission present: true`. |
| 3.2 | Confirm the sender mailbox can receive replies. | Send a manual test message | Delivery receipt / mailbox screenshot. |
| 3.3 | Confirm PostgreSQL is reachable and migrations are current. | `pnpm -F @projectx/infrastructure exec jest` or migration status | Health check / migration table. |
| 3.4 | Confirm Redis is reachable. | `redis-cli ping` or health endpoint | `PONG` / health output. |
| 3.5 | Confirm Temporal is reachable. | `temporal operator cluster health` or UI | Health output. |
| 3.6 | Confirm RLS is active. | `SELECT current_setting('app.current_tenant', TRUE);` inside a tenant query | No error, tenant isolated. |
| 3.7 | Confirm the allowlist table is empty. | `SELECT COUNT(*) FROM outreach.allowed_recipients;` | `0`. |
| 3.8 | Confirm suppression table is empty for the test recipient. | `SELECT COUNT(*) FROM outreach.suppression WHERE email = '<test>';` | `0`. |

---

## APPROVE — Arm the single-shot test

| # | Action | Command / Reference | Evidence |
|---|--------|---------------------|----------|
| 4.1 | Insert exactly one allowlisted test recipient. | `INSERT INTO outreach.allowed_recipients (tenant_id, channel, address, approved_by, approved_at) VALUES (...);` | Row ID / query result. |
| 4.2 | Run the operator PREPARE command to create the campaign/sequence and start the workflow. | `PHASE14_TENANT_ID=<tenant> PHASE14_RECIPIENT_EMAIL=<test> pnpm phase14:prepare-real-send` | `campaignId`, `sequenceId`, `executionId` (or pending note), `workflowId`. |
| 4.3 | Verify the workflow has reached `AWAITING_APPROVAL`. The workflow runs `prepareDraft` via the outreach worker; if the worker is not yet running, the command prints a pending note and the workflow ID. | Temporal UI / execution log | `executionId` and workflow status. |
| 4.4 | Do NOT create or approve the send yet; the EXECUTE command will create and consume the first-send approval record. | — | — |
| 4.5 | Double-check suppression is still empty for the recipient. | Repeat 3.8 | `0`. |
| 4.6 | Set `OUTREACH_LIVE_EMAIL_ENABLED=true` only in worker and API environments. | Secret store / env update | Redacted config screenshot showing `true`. |
| 4.7 | Restart worker and API to pick up the change. | `systemctl restart` / container restart | Restart logs. |

---

## SEND — Trigger the first real email

| # | Action | Command / Reference | Evidence to capture |
|---|--------|---------------------|---------------------|
| 5.1 | Operator confirms and triggers the real send. This creates a first-send approval record, signals `outreachApprovalGranted` to the deterministic workflow, and polls for terminal status. | `OUTREACH_LIVE_EMAIL_ENABLED=true PHASE14_TENANT_ID=<tenant> PHASE14_OPERATOR_ID=<operator> pnpm phase14:execute-real-send [sequenceId]` | Approval event ID, timestamp, `executionId`, `providerMessageId`, `internetMessageId`. |
| 5.2 | Workflow calls `executeApprovedSend`. | Temporal execution history | `workflowId`, `executionId`, `sequenceId`, `correlationId`. |
| 5.3 | `SendSafetyGate` evaluates ALLOW. | Audit log query | Audit event with `result: success`, tenant, recipient, campaign, sequence, execution, approval IDs. |
| 5.4 | `GraphEmailProvider` acquires token. | Telemetry / logs | Token acquisition span (sanitized, no token value). |
| 5.5 | `POST /users/{GRAPH_SENDER_ADDRESS}/sendMail` returns 202. | Graph trace / logs | Graph response status, sanitized request trace. |
| 5.6 | Provider performs Sent Items lookup and captures `internetMessageId`. | Graph trace / logs | `providerMessageId` value (e.g. `<...>`). |
| 5.7 | Execution row moves to `ACCEPTED` with `provider_message_id`. | DB query | DB row screenshot / query result. |
| 5.8 | Idempotency key is marked `COMPLETED`. | DB query | `idempotency.keys` row. |

---

## RECEIVE — Capture the reply

| # | Action | Evidence to capture |
|---|--------|---------------------|
| 6.1 | Test recipient replies to the email. | Reply timestamp, original `internetMessageId`. |
| 6.2 | Graph change notification fires to `POST /webhooks/graph/email`. | Notification JSON (redact bearer tokens / secrets). |
| 6.3 | API webhook validates `clientState`, size, shape. | Webhook response status, validation logs. |
| 6.4 | Tenant resolved from notification mailbox path. | Resolved `tenantId`. |
| 6.5 | Message fetched from Graph and deduplicated atomically. | Fetched message `internetMessageId`, `inReplyTo`, `references`. |
| 6.6 | HTML sanitized and PII scrubbed. | Sanitized body sample (redact sensitive content). |
| 6.7 | `GraphReplyCorrelator` matches reply to outbound execution. | Correlated `executionId`, `providerMessageId`, `conversationId`. |
| 6.8 | `DeterministicIntentClassifier` classifies intent. | Intent label, confidence. |
| 6.9 | `TemporalSignalDispatcher` sends `replyReceived` to deterministic workflow ID. | Signal dispatch log, `workflowId`. |
| 6.10 | Workflow resumes and records response. | Workflow execution history / log. |

---

## VERIFY END-TO-END — Confirm complete lifecycle

| # | Check | Expected result |
|---|-------|-----------------|
| 7.1 | Exactly one email sent. | `message_executions.sent_at` is set once; `campaign.sent_count = 1`. |
| 7.2 | Reply correlated correctly. | `conversations` row links reply to outbound `executionId`. |
| 7.3 | Workflow advanced or completed. | `sequence.current_step_index` incremented or sequence status `COMPLETED`. |
| 7.4 | Audit log contains full chain. | ALLOW decision, Graph send, webhook ingress, correlation, signal dispatch, workflow resume. |
| 7.5 | Telemetry captured spans. | OTel traces for send + reply path. |
| 7.6 | No second send attempted. | Idempotency key is `COMPLETED`; second `executeApprovedSend` returns duplicate-block. |
| 7.7 | Rate-limit counter incremented. | Redis key exists for tenant/channel window. |

---

## DISABLE — Shut down live email immediately after validation

| # | Action | Evidence |
|---|--------|----------|
| 8.1 | Set `OUTREACH_LIVE_EMAIL_ENABLED=false` in worker and API environments. | Redacted config screenshot. |
| 8.2 | Restart worker and API. | Restart logs. |
| 8.3 | Delete the Graph subscription. | `DELETE /admin/graph/subscriptions/{id}` response. |
| 8.4 | Optionally remove the single allowlist entry. | `DELETE FROM outreach.allowed_recipients WHERE ...;` / query result. |
| 8.5 | Export and retain audit logs. | Exported archive path / checksum. |
| 8.6 | Verify a new send request is denied with `LIVE_EMAIL_DISABLED`. | Test send attempt + denial log. |

---

## POST-TEST REVIEW — Package evidence for ARB

| # | Action | Artifact |
|---|--------|----------|
| 9.1 | Fill in `docs/reports/phase14-8-first-real-send-execution-report.md` with all captured evidence. | Completed report. |
| 9.2 | Attach Snyk reports or exception documentation. | `snyk-code-report.json`, `snyk-deps-report.json`. |
| 9.3 | Attach Entra app registration and permission evidence. | Screenshots / CLI output. |
| 9.4 | Attach sanitized Graph request/response traces. | Trace logs / HAR (no secrets). |
| 9.5 | Attach audit/telemetry exports. | Log archive, trace IDs. |
| 9.6 | Record any anomalies, even if they did not block the test. | Anomaly log. |
| 9.7 | Make a GO / NO-GO recommendation. | ARB submission. |

---

## Emergency stop

If anything goes wrong during SEND or RECEIVE:

1. Set `OUTREACH_LIVE_EMAIL_ENABLED=false` and restart workers/API immediately.
2. Delete the Graph subscription via `DELETE /admin/graph/subscriptions/{id}`.
3. Remove the allowlist row if it is safe to do so without losing audit context.
4. Add the recipient to `outreach.suppression` if they must not be contacted again.
5. Cancel the sequence workflow via Temporal UI/CLI using `WorkflowIdFactory.forOutreachSequence(tenantId, sequenceId)`.
6. Preserve all logs and audit records before debugging.
7. Do **not** retry the real send without ARB approval.
