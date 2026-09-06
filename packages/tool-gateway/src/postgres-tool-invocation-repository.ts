import type { TenantContext } from '@projectx/domain';
import type { ToolCallStatus } from '@projectx/shared';
import { PostgresClient } from '@projectx/infrastructure';
import type {
  IToolInvocationRepository,
  ToolInvocationAttemptRecord,
  ToolInvocationRecord,
} from './tool-invocation-repository.interface';

interface InvRow {
  tool_call_id: string;
  tool_definition_id: string;
  tool_id: string;
  version: string;
  provider_id: string;
  tenant_id: string;
  mission_id: string | null;
  execution_id: string | null;
  task_id: string | null;
  agent_id: string | null;
  correlation_id: string;
  action: string | null;
  idempotency_key: string | null;
  decision: string | null;
  status: ToolCallStatus;
  audit_id: string | null;
  started_at: Date;
  completed_at: Date | null;
  error: Record<string, unknown> | null;
}

interface AttRow {
  tenant_id: string;
  tool_call_id: string;
  attempt: number;
  tool_definition_id: string;
  provider_id: string;
  attempt_status: ToolInvocationAttemptRecord['status'];
  submitted: boolean | null;
  result_known: boolean | null;
  failure_classification: string | null;
  retryable: boolean | null;
  provider_request_id: string | null;
  started_at: Date;
  completed_at: Date | null;
}

function toInvocation(r: InvRow): ToolInvocationRecord {
  return {
    toolCallId: r.tool_call_id,
    toolDefinitionId: r.tool_definition_id,
    toolId: r.tool_id,
    version: r.version,
    providerId: r.provider_id,
    tenantId: r.tenant_id,
    missionId: r.mission_id ?? undefined,
    executionId: r.execution_id ?? undefined,
    taskId: r.task_id ?? undefined,
    agentId: r.agent_id ?? undefined,
    correlationId: r.correlation_id,
    action: r.action ?? undefined,
    idempotencyKey: r.idempotency_key ?? undefined,
    decision: r.decision ?? undefined,
    status: r.status,
    auditId: r.audit_id ?? undefined,
    startedAt: r.started_at,
    completedAt: r.completed_at ?? undefined,
    error: r.error ?? undefined,
  };
}

function toAttempt(r: AttRow): ToolInvocationAttemptRecord {
  return {
    tenantId: r.tenant_id,
    toolCallId: r.tool_call_id,
    attempt: r.attempt,
    toolDefinitionId: r.tool_definition_id,
    providerId: r.provider_id,
    status: r.attempt_status,
    submitted: r.submitted ?? undefined,
    resultKnown: r.result_known ?? undefined,
    failureClassification: r.failure_classification ?? undefined,
    retryable: r.retryable ?? undefined,
    providerRequestId: r.provider_request_id ?? undefined,
    startedAt: r.started_at,
    completedAt: r.completed_at ?? undefined,
  };
}

/** Postgres-backed invocation + attempt repository (RLS via app.current_tenant). */
export class PostgresToolInvocationRepository implements IToolInvocationRepository {
  constructor(private readonly client: PostgresClient) {}

  async createInvocation(ctx: TenantContext, r: ToolInvocationRecord): Promise<void> {
    await this.client.withTenant(ctx, (c) =>
      c.query(
        `INSERT INTO tool_registry.tool_invocations
          (tool_call_id, tool_definition_id, tool_id, version, provider_id, tenant_id,
           mission_id, execution_id, task_id, agent_id, correlation_id, action,
           idempotency_key, decision, status, audit_id, started_at, error)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          r.toolCallId, r.toolDefinitionId, r.toolId, r.version, r.providerId, r.tenantId,
          r.missionId ?? null, r.executionId ?? null, r.taskId ?? null, r.agentId ?? null,
          r.correlationId, r.action ?? null, r.idempotencyKey ?? null, r.decision ?? null,
          r.status, r.auditId ?? null, r.startedAt, r.error ? JSON.stringify(r.error) : null,
        ],
      ),
    );
  }

  async completeInvocation(
    ctx: TenantContext,
    toolCallId: string,
    update: { status: ToolCallStatus; auditId?: string; error?: Record<string, unknown> },
  ): Promise<void> {
    await this.client.withTenant(ctx, (c) =>
      c.query(
        `UPDATE tool_registry.tool_invocations
           SET status = $1, completed_at = NOW(), audit_id = COALESCE($2, audit_id),
               error = COALESCE($3, error)
         WHERE tool_call_id = $4`,
        [update.status, update.auditId ?? null, update.error ? JSON.stringify(update.error) : null, toolCallId],
      ),
    );
  }

  async createAttempt(ctx: TenantContext, r: ToolInvocationAttemptRecord): Promise<void> {
    await this.client.withTenant(ctx, (c) =>
      c.query(
        `INSERT INTO tool_registry.tool_invocation_attempts
          (tenant_id, tool_call_id, attempt, tool_definition_id, provider_id,
           attempt_status, submitted, result_known, failure_classification,
           retryable, provider_request_id, started_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          r.tenantId, r.toolCallId, r.attempt, r.toolDefinitionId, r.providerId,
          r.status, r.submitted ?? null, r.resultKnown ?? null,
          r.failureClassification ?? null, r.retryable ?? null,
          r.providerRequestId ?? null, r.startedAt,
        ],
      ),
    );
  }

  async completeAttempt(
    ctx: TenantContext,
    toolCallId: string,
    attempt: number,
    update: Partial<Pick<ToolInvocationAttemptRecord,
      'status' | 'submitted' | 'resultKnown' | 'failureClassification' | 'retryable' | 'providerRequestId'>>,
  ): Promise<void> {
    await this.client.withTenant(ctx, (c) =>
      c.query(
        `UPDATE tool_registry.tool_invocation_attempts
           SET attempt_status = COALESCE($1, attempt_status),
               submitted = COALESCE($2, submitted),
               result_known = COALESCE($3, result_known),
               failure_classification = COALESCE($4, failure_classification),
               retryable = COALESCE($5, retryable),
               provider_request_id = COALESCE($6, provider_request_id),
               completed_at = NOW()
         WHERE tool_call_id = $7 AND attempt = $8`,
        [
          update.status ?? null,
          update.submitted ?? null,
          update.resultKnown ?? null,
          update.failureClassification ?? null,
          update.retryable ?? null,
          update.providerRequestId ?? null,
          toolCallId,
          attempt,
        ],
      ),
    );
  }

  async getInvocation(ctx: TenantContext, toolCallId: string): Promise<ToolInvocationRecord | undefined> {
    const res = await this.client.withTenant(ctx, (c) =>
      c.query<InvRow>(`SELECT * FROM tool_registry.tool_invocations WHERE tool_call_id = $1`, [toolCallId]),
    );
    return res.rows[0] ? toInvocation(res.rows[0]) : undefined;
  }

  async listAttempts(ctx: TenantContext, toolCallId: string): Promise<ToolInvocationAttemptRecord[]> {
    const res = await this.client.withTenant(ctx, (c) =>
      c.query<AttRow>(
        `SELECT * FROM tool_registry.tool_invocation_attempts WHERE tool_call_id = $1 ORDER BY attempt`,
        [toolCallId],
      ),
    );
    return res.rows.map(toAttempt);
  }
}
