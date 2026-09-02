import type { TenantId, UserId } from '@projectx/shared';

export type ActorType = 'human' | 'agent' | 'system' | 'external';

export class Actor {
  private constructor(
    public readonly type: ActorType,
    public readonly id: string,
    public readonly tenantId: TenantId,
  ) {}

  static human(userId: UserId, tenantId: TenantId): Actor {
    return new Actor('human', userId, tenantId);
  }

  static agent(agentId: string, tenantId: TenantId): Actor {
    return new Actor('agent', agentId, tenantId);
  }

  static system(systemId: string, tenantId: TenantId): Actor {
    return new Actor('system', systemId, tenantId);
  }

  static external(externalId: string, tenantId: TenantId): Actor {
    return new Actor('external', externalId, tenantId);
  }
}
