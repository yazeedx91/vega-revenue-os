import type { TenantContext } from '@projectx/domain';

export class MissionWorkspaceResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissionWorkspaceResolutionError';
  }
}

export interface IMissionWorkspaceResolver {
  resolveAuthorizedWorkspace(ctx: TenantContext, missionId: string): Promise<string>;
}
