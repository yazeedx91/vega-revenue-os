import type { AgentContract } from '@projectx/shared';

export interface ResolvedAgent extends AgentContract {
  versionId: string;
  tenantId: string | null;
  isSystem: boolean;
  implementationKey: string;
  contract: AgentContract;
}

export function toResolvedAgent(
  contract: AgentContract,
  implementationKey: string,
  isSystem = false,
  tenantId: string | null = null,
): ResolvedAgent {
  return {
    ...contract,
    versionId: contract.agentId + ':' + contract.version,
    agentId: contract.agentId,
    tenantId,
    isSystem,
    version: contract.version,
    lifecycle: contract.lifecycle,
    implementationKey,
    contract,
  };
}
