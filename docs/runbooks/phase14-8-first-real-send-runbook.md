# Phase 14.8 — First Controlled Real Email / Reply Runbook

**Objective:** Send exactly one real email to a single allowlisted test recipient through Microsoft Graph, receive its reply, and verify end-to-end safety, audit, and correlation.

**Prerequisites:** Phase 14.8a code wiring complete; Snyk scan clean or exception-approved; dedicated Entra test tenant provisioned per ADR-131; production Postgres/Redis/Temporal verified.

---

## 1. Pre-flight checklist

| # | Check | Command / Action | Expected state |
|---|-------|------------------|----------------|
| 1.1 | `OUTREACH_LIVE_EMAIL_ENABLED` is exactly `'true'` only during the test | Verify deployment env | `true` |
| 1.2 | `OUTREACH_MODE` is `ALLOWLIST_ONLY` | Verify deployment env | `ALLOWREACH_ONLY` |
| 1.3 | Graph secrets present | `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_SENDER_ADDRESS` | All populated |
| 1.4 | Postgres/Redis/Temporal healthy | Hit health endpoints | 200 OK |
| 1.5 | Migrations applied and RLS enabled | `SELECT current_setting('app.current_tenant', TRUE);` | No error |
| 1.6 | Worker and API running with durable adapters | Check worker logs | `DATABASE_URL` connected |
| 1.7 | Exactly one recipient in `outreach.allowed_recipients` | Query `SELECT * FROM outreach.allowed_recipients;` | 1 row |
| 1.8 | Recipient not suppressed | `SELECT * FROM outreach.suppression WHERE email = '...';` | 0 rows |
| 1.9 | Admin API key set and known | Verify `ADMIN_API_KEY` / `ADMIN_API_KEY_SECRET_REFERENCE` | Ready |
| 1.10 | Graph webhook subscription created | `POST /admin/graph/subscriptions` for `Users/{sender}/Messages` | 201 + subscriptionId |
| 1.11 | Human approver standing by | Confirm contact | Ready |

---

## 2. Enable

1. Start `apps/temporal-worker` with `DATABASE_URL`, `REDIS_URL`, `TEMPORAL_ADDRESS`.
2. Start `apps/api` with the same environment.
3. Confirm worker log line: `live-email mode ALLOWLIST_ONLY, Postgres + Redis connected`.
4. Confirm API health endpoint returns 200.

---

## 3. Send

1. Create campaign/sequence for the allowlisted recipient via admin/API path.
2. Workflow prepares a draft and waits on `outreachApprovalGranted`.
3. Human creates an approval record with:
   - `actionType = OUTREACH_EMAIL_SEND`
   - `status = APPROVED`
   - matching `tenantId`, `campaignId`, `sequenceId`, `executionId`, `recipientAddress`
4. Workflow calls `executeApprovedSend`.
5. Observe `SendSafetyGate` decision in audit log (`result: success`, `decision: ALLOW`).
6. Observe `GraphEmailProvider` acquire token, call `POST /users/{sender}/sendMail`, return `ACCEPTED`.
7. Record the captured `internetMessageId` from `message_executions.provider_message_id`.

---

## 4. Receive

1. From the allowlisted recipient mailbox, reply to the received email.
2. Graph fires a change notification to `POST /webhooks/graph/email`.
3. Verify webhook response: `200 OK`.
4. Verify pipeline logs:
   - webhook validation passed
   - tenant resolved
   - atomic dedup claim succeeded
   - message fetched from Graph
   - HTML sanitized + PII scrubbed
   - `GraphReplyCorrelator` matched by `In-Reply-To` / `References`
5. Verify Temporal `replyReceived` signal dispatched to deterministic workflowId.
6. Workflow records response and advances/terminates.

---

## 5. Verify

1. Audit log contains:
   - safety decision `ALLOW`
   - Graph send outcome
   - webhook ingress
   - signal dispatch
   - conversation create/update
   - workflow completion
2. `message_executions` row shows status `ACCEPTED` → `DELIVERED`/`REPLIED` with the real `providerMessageId`.
3. `conversations` row contains the reply and latest intent.
4. Idempotency key in `idempotency.keys` is `COMPLETED` — no second send occurred.
5. Redis rate-limit counters incremented.
6. Campaign `sentCount` / `spentCostUsd` updated.

---

## 6. Disable / rollback

1. Set `OUTREACH_LIVE_EMAIL_ENABLED=false` and restart workers.
2. Delete Graph subscription: `DELETE /admin/graph/subscriptions/{id}`.
3. Optionally remove the allowlist row.
4. Export/retain audit logs.
5. Verify a new send request is denied with `LIVE_EMAIL_DISABLED`.

---

## 7. Emergency stop

| Situation | Action |
|-----------|--------|
| Need to stop all outbound immediately | Set `OUTREACH_LIVE_EMAIL_ENABLED=false` and restart workers. |
| Need to stop a specific recipient | Remove from `outreach.allowed_recipients` and add to `outreach.suppression`. |
| Need to stop Graph webhooks | Delete the subscription via admin API and rotate `ADMIN_API_KEY`. |
| Need to halt workflows | Cancel via Temporal UI/CLI using `WorkflowIdFactory.forOutreachSequence(tenantId, sequenceId)`. |

---

## 8. ARB sign-off package

Attach to the refreshed readiness review:
- [ ] This runbook, executed and timestamped.
- [ ] Snyk code + dependency scan reports.
- [ ] Entra app registration screenshot / CLI output showing only `Mail.Send`.
- [ ] Environment verification evidence (Postgres/Redis/Temporal health, backups, RLS).
- [ ] Audit log export for the first send + reply.
- [ ] Idempotency key record showing `COMPLETED`.
