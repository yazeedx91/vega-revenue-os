import type { TenantContext } from '@projectx/domain';
import type { IInvocationAccounting, LLMInvocationRecord } from './invocation-accounting.interface';

export class InMemoryInvocationAccounting implements IInvocationAccounting {
  private readonly byTenant = new Map<string, LLMInvocationRecord[]>();

  async record(ctx: TenantContext, record: LLMInvocationRecord): Promise<void> {
    const list = this.byTenant.get(ctx.tenantId as string) ?? [];
    list.push({ ...record, recordedAt: record.recordedAt ?? new Date() });
    this.byTenant.set(ctx.tenantId as string, list);
  }

  async listByExecution(ctx: TenantContext, executionId: string): Promise<readonly LLMInvocationRecord[]> {
    const list = this.byTenant.get(ctx.tenantId as string) ?? [];
    return list.filter((r) => r.executionId === executionId);
  }
}
