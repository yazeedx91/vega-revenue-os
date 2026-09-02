import type { TenantId } from '@projectx/shared';
import type { Mission } from '@projectx/domain';
import type { IMissionRepository } from '../ports/mission-repository.interface';

export class InMemoryMissionRepository implements IMissionRepository {
  private readonly missions = new Map<string, Mission>();

  async load(tenantId: TenantId, missionId: string): Promise<Mission | null> {
    const key = `${tenantId}:${missionId}`;
    return this.missions.get(key) ?? null;
  }

  async save(mission: Mission): Promise<void> {
    const key = `${mission.tenantId}:${mission.id}`;
    this.missions.set(key, mission);
  }
}
