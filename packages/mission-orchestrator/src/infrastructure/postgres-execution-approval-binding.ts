import type { TenantContext } from '@projectx/domain';
import { PostgresClient } from '@projectx/infrastructure';
import type {
  ExecutionApprovalBinding,
  ExecutionApprovalEvidence,
  IExecutionApprovalBinding,
} from '@projectx/ai-runtime';

/**
 * Postgres-backed implementation of the executor's approval-binding check.
 * Reads the authoritative mission.approvals table (the single approval
 * authority) under the current tenant's RLS context and returns true only when
 * an APPROVED, unexpired approval is bound to the exact
 * execution/action/idempotency key. This is a read-only check — it does not
 * create or mutate approvals.
 */
export class PostgresExecutionApprovalBinding implements IExecutionApprovalBinding {
  constructor(private readonly client: PostgresClient) {}

  async hasValidApproval(ctx: TenantContext, binding: ExecutionApprovalBinding): Promise<boolean> {
    return (await this.resolveValidApproval(ctx, binding)) !== null;
  }

  async resolveValidApproval(
    ctx: TenantContext,
    binding: ExecutionApprovalBinding,
  ): Promise<ExecutionApprovalEvidence | null> {
    return this.client.withTenant(ctx, async (client) => {
      // The approvals aggregate is persisted as a JSONB payload. Match the
      // execution's stable identity (executionId + idempotencyKey) and apply
      // the same status + expiry semantics as the authoritative Approval
      // aggregate / ApprovalVerificationAdapter (createdAt + timeoutSeconds).
      const result = await client.query(
        `SELECT id, payload->>'status' AS status
           FROM mission.approvals
          WHERE payload->>'executionId' = $1
            AND payload->>'idempotencyKey' = $2
            AND payload->>'status' = 'APPROVED'
            AND ($3::text IS NULL OR payload->>'actionType' = $3)
            AND ((payload->>'createdAt')::timestamptz
                 + ((payload->>'timeoutSeconds')::int * INTERVAL '1 second')) > now()
          LIMIT 1`,
        [binding.executionId, binding.idempotencyKey, binding.actionType ?? null],
      );
      const row = result.rows[0] as { id: string; status: string } | undefined;
      if (!row) return null;
      return { approvalId: row.id, status: row.status, validation: 'valid' };
    });
  }
}
