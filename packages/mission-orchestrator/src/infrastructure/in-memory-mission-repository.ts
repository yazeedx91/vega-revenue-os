import type { TenantContext } from '@projectx/domain';
import type { Mission } from '@projectx/domain';
import type { IMissionRepository } from '../ports/mission-repository.interface';

export class InMemoryMissionRepository implements IMissionRepository {
  private readonly missions = new Map<string, Mission>();

  async findById(_ctx: TenantContext, missionId: string): Promise<Mission | null> {
    for (const mission of this.missions.values()) {
      if (mission.id === missionId) return mission;
    }
    return null;
  }

  async save(_ctx: TenantContext, mission: Mission): Promise<void> {
    const key = `${mission.tenantId}:${mission.id}`;
    this.missions.set(key, mission);
  }
}
