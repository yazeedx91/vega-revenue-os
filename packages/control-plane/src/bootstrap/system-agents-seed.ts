import type { TenantContext } from '@projectx/domain';
import type { AgentContract } from '@projectx/shared';
import { SYSTEM_SPECIALIST_DEFINITIONS, type SpecialistDefinition } from '@projectx/specialist-agents';
import { ControlPlaneService, AgentLifecycleService } from '../application';
import type { ControlPlaneServiceDependencies, AgentLifecycleServiceDependencies } from '../application';
import type { AgentLifecycle, AgentVersion, Capability } from '../domain';

export interface SystemAgentsSeedDependencies {
  controlPlane: ControlPlaneServiceDependencies;
  lifecycle: AgentLifecycleServiceDependencies;
}

const now = new Date();

function buildAgentContract(def: SpecialistDefinition): AgentContract {
  return {
    ...def.contract,
    agentId: def.agentId,
    version: def.contract.version ?? '1.0.0',
    lifecycle: 'DRAFT' as AgentLifecycle,
    createdAt: now,
    updatedAt: now,
  } as AgentContract;
}

function buildCapability(capabilityId: string, def: SpecialistDefinition): Capability {
  return {
    capabilityId,
    name: capabilityId,
    description: `${def.contract.name ?? def.agentId} capability`,
    riskCategory: 'LOW',
    allowedTools: def.contract.tools as string[],
    requiredPolicies: [],
  };
}

export class SystemAgentsSeed {
  constructor(private readonly deps: SystemAgentsSeedDependencies) {}

  async seed(ctx: TenantContext): Promise<void> {
    const controlPlaneService = new ControlPlaneService(this.deps.controlPlane);
    const agentLifecycleService = new AgentLifecycleService(this.deps.lifecycle);

    for (const def of SYSTEM_SPECIALIST_DEFINITIONS) {
      const contract = buildAgentContract(def);

      for (const capabilityId of contract.capabilities) {
        await controlPlaneService.registerCapability(ctx, buildCapability(capabilityId, def));
      }

      const version: AgentVersion = {
        versionId: `${def.agentId}:${contract.version}`,
        agentId: def.agentId,
        tenantId: null,
        isSystem: true,
        version: contract.version,
        lifecycle: 'DRAFT' as AgentLifecycle,
        implementationKey: def.implementationKey,
        definition: contract,
      };

      await controlPlaneService.registerAgentVersion(ctx, version);
      await agentLifecycleService.transition(ctx, def.agentId, contract.version, 'TESTING');
      await agentLifecycleService.transition(ctx, def.agentId, contract.version, 'APPROVED');
      await agentLifecycleService.transition(ctx, def.agentId, contract.version, 'ACTIVE');
    }
  }
}
