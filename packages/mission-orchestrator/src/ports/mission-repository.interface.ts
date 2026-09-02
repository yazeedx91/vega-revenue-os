import type { TenantId } from '@projectx/shared';
import type { Mission } from '@projectx/domain';

export interface IMissionRepository {
  load(tenantId: TenantId, missionId: string): Promise<Mission | null>;
  save(mission: Mission): Promise<void>;
}
