import type { TenantContext } from '@projectx/domain';
import type { ResolvedAgent } from './resolved-agent';

export type { ResolvedAgent } from './resolved-agent';

export interface IAgentRegistry {
  getAgent(ctx: TenantContext, agentId: string, version?: string): Promise<ResolvedAgent | null>;
  getCapability(tenantId: string, capabilityId: string): Promise<{ capabilityId: string; allowedTools: string[] } | null>;
}
