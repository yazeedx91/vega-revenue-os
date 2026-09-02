# P0-3 Reconciliation Runbook

## Purpose
Resumable outbound sends can leave a `MessageExecution` in `DELIVERY_UNKNOWN` or `REQUIRES_RECONCILIATION` after a worker crash, provider ambiguity, or a Redis/PostgreSQL outage. This runbook describes how an operator determines the true provider state and resolves the execution without risking a duplicate send.

## When to use
- `readyz` or `/readyz` reports a dependency outage has recovered but a workflow is stuck.
- The `ReconciliationQueryService` returns executions with `status = 'DELIVERY_UNKNOWN'` or `'REQUIRES_RECONCILIATION'`.
- A `providerMessageId` is found in provider logs that does not yet exist in the `outreach.message_executions` payload.

## Required before action
- `OUTREACH_LIVE_EMAIL_ENABLED` must be `false` unless the action is part of a controlled allowlist-only window.
- The operator must have a second reviewer for `DELIVERED` reconciliation decisions.

## Steps

1. **Identify the candidate execution**
   - Call `ReconciliationQueryService.findUnknownOrRequiresReconciliation(ctx)` for the tenant.
   - Note the `executionId`, `idempotencyKey`, `providerId`, `attempts`, and `lastError`.

2. **Check the provider authoritative state**
   - Search the provider Sent Items / sent folder for the `internetMessageId` or the recipient + timestamp.
   - If a `providerMessageId` is found, record it. If no trace exists, confirm with provider logs that the send did not happen.

3. **Make the decision**
   - If the provider confirms the message was accepted/sent, use `ReconciliationService.reconcile(ctx, executionId, 'DELIVERED', operatorId, reason, providerMessageId)`.
   - If the provider confirms the message was **not** sent, use `ReconciliationService.reconcile(ctx, executionId, 'FAILED', operatorId, reason)`.
     - This will set the `MessageExecution` to `FAILED` and the idempotency key to `FAILED` with `submitted: true`, preventing an automatic retry. A new send requires a new `MessageExecution` and a new idempotency key.

4. **Verify the result**
   - Re-query the execution and confirm it is now `DELIVERED` or `FAILED`.
   - Review the `audit_log` record with `action = 'OUTREACH_RECONCILIATION_DECISION'`.

## Rollback / correction
If a `DELIVERED` reconciliation was made in error, do **not** retry the same `idempotencyKey`. Create a new `MessageExecution` with a new idempotency key if another send is required.
