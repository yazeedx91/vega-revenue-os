import type { TenantContext } from '@projectx/domain';
import type { Mission } from '@projectx/domain';
import type { IMissionRepository } from '../ports/mission-repository.interface';

export class InMemoryMissionRepository implements IMissionRepository {
  private readonly missions = new Map<string, Mission>();

  async findById(ctx: TenantContext, missionId: string): Promise<Mission | null> {
    if (!ctx.workspaceId) return null;
    const mission = this.missions.get(`${ctx.tenantId}:${ctx.workspaceId}:${missionId}`);
    return mission?.workspaceBindingState === 'WORKSPACE_BOUND' ? mission : null;
  }

  async save(ctx: TenantContext, mission: Mission): Promise<void> {
    if (!ctx.workspaceId || mission.tenantId !== ctx.tenantId || mission.workspaceId !== ctx.workspaceId || mission.workspaceBindingState !== 'WORKSPACE_BOUND') {
      throw new Error('Mission workspace ownership mismatch');
    }
    const key = `${mission.tenantId}:${mission.workspaceId}:${mission.id}`;
    this.missions.set(key, mission);
  }
}
