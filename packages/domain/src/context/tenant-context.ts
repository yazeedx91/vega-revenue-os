import type { TenantId } from '@projectx/shared';

/**
 * Immutable tenant context that must be threaded through every operation.
 */
export interface TenantContext {
  readonly tenantId: TenantId;
  readonly workspaceId?: string;
  readonly correlationId: string;
  readonly userId?: string;
  readonly agentId?: string;
  readonly missionId?: string;
}
