import type { TenantContext } from '@projectx/domain';
import type { AgentContract } from '@projectx/shared';

export interface IAgentRegistry {
  getAgent(ctx: TenantContext, agentId: string, version?: string): Promise<AgentContract | null>;
  getCapability(tenantId: string, capabilityId: string): Promise<{ capabilityId: string; allowedTools: string[] } | null>;
}
