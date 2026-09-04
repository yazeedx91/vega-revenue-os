import type { TenantContext } from '@projectx/domain';
import type { IReasoningArtifactRepository, ReasoningArtifact } from './reasoning-artifact.interface';

export class InMemoryReasoningArtifactRepository implements IReasoningArtifactRepository {
  private readonly byTenant = new Map<string, ReasoningArtifact[]>();

  async save(ctx: TenantContext, artifact: ReasoningArtifact): Promise<void> {
    const list = this.byTenant.get(ctx.tenantId as string) ?? [];
    list.push({ ...artifact, recordedAt: artifact.recordedAt ?? new Date() });
    this.byTenant.set(ctx.tenantId as string, list);
  }

  async listByExecution(ctx: TenantContext, executionId: string): Promise<readonly ReasoningArtifact[]> {
    const list = this.byTenant.get(ctx.tenantId as string) ?? [];
    return list.filter((a) => a.executionId === executionId);
  }
}
