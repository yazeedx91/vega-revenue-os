import type { TenantContext } from '@projectx/domain';
import type { ToolCallStatus } from '@projectx/shared';
import type {
  IToolInvocationRepository,
  ToolInvocationAttemptRecord,
  ToolInvocationRecord,
} from './tool-invocation-repository.interface';

/** In-memory invocation repository for unit tests / local development. */
export class InMemoryToolInvocationRepository implements IToolInvocationRepository {
  private readonly invocations = new Map<string, ToolInvocationRecord>();
  private readonly attempts = new Map<string, ToolInvocationAttemptRecord>();

  async createInvocation(_ctx: TenantContext, record: ToolInvocationRecord): Promise<void> {
    this.invocations.set(record.toolCallId, { ...record });
  }

  async completeInvocation(
    _ctx: TenantContext,
    toolCallId: string,
    update: { status: ToolCallStatus; auditId?: string; error?: Record<string, unknown> },
  ): Promise<void> {
    const inv = this.invocations.get(toolCallId);
    if (!inv) throw new Error(`invocation ${toolCallId} not found`);
    inv.status = update.status;
    inv.completedAt = new Date();
    if (update.auditId) inv.auditId = update.auditId;
    if (update.error) inv.error = update.error;
  }

  async createAttempt(_ctx: TenantContext, record: ToolInvocationAttemptRecord): Promise<void> {
    this.attempts.set(`${record.toolCallId}#${record.attempt}`, { ...record });
  }

  async completeAttempt(
    _ctx: TenantContext,
    toolCallId: string,
    attempt: number,
    update: Partial<Pick<ToolInvocationAttemptRecord,
      'status' | 'submitted' | 'resultKnown' | 'failureClassification' | 'retryable' | 'providerRequestId'>>,
  ): Promise<void> {
    const rec = this.attempts.get(`${toolCallId}#${attempt}`);
    if (!rec) throw new Error(`attempt ${toolCallId}#${attempt} not found`);
    Object.assign(rec, update);
    rec.completedAt = new Date();
  }

  async getInvocation(_ctx: TenantContext, toolCallId: string): Promise<ToolInvocationRecord | undefined> {
    return this.invocations.get(toolCallId);
  }

  async listAttempts(_ctx: TenantContext, toolCallId: string): Promise<ToolInvocationAttemptRecord[]> {
    return [...this.attempts.values()].filter((a) => a.toolCallId === toolCallId);
  }
}
