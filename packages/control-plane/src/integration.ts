import type { TenantContext } from '@projectx/domain';
import { asCorrelationId, asTenantId } from '@projectx/shared';
import type { AgentContract } from '@projectx/shared';
import { toResolvedAgent } from '@projectx/ai-runtime';
import type { IAgentRegistry, IPolicyClient, PolicyDecision, ResolvedAgent } from '@projectx/ai-runtime';
import type { AIExecutionRequest } from '@projectx/shared';
import type { PolicyEvaluationService } from './application';
import type { IAgentRepository, ICapabilityRepository } from './ports';
import type { AgentVersion } from './domain';

export interface ControlPlaneAgentRegistryDependencies {
  readonly agentRepository: IAgentRepository;
  readonly capabilityRepository: ICapabilityRepository;
}

export interface ControlPlaneRegistryCapability {
  readonly capabilityId: string;
  readonly allowedTools: string[];
}

export class AmbiguousCapabilityError extends Error {
  constructor(public readonly capabilityId: string) {
    super(`Multiple active agents claim capability ${capabilityId}; selection is ambiguous`);
  }
}

export class ControlPlaneAgentRegistry implements IAgentRegistry {
  constructor(private readonly deps: ControlPlaneAgentRegistryDependencies) {}

  async getAgent(
    ctx: TenantContext,
    agentId: string,
    version?: string,
  ): Promise<ResolvedAgent | null> {
    const activeVersion = await this.deps.agentRepository.getActiveVersion(ctx, agentId, version);
    if (!activeVersion) return null;
    return this.mapToResolvedAgent(activeVersion);
  }

  async getCapability(
    tenantId: string,
    capabilityId: string,
  ): Promise<ControlPlaneRegistryCapability | null> {
    const ctx: TenantContext = {
      tenantId: asTenantId(tenantId),
      correlationId: asCorrelationId(''),
    };
    const capability = await this.deps.capabilityRepository.getGlobalCapability(ctx, capabilityId);
    if (!capability) return null;
    return {
      capabilityId: capability.capabilityId,
      allowedTools: capability.allowedTools,
    };
  }

  async selectActiveAgentForCapability(ctx: TenantContext, capabilityId: string): Promise<ResolvedAgent> {
    const activeVersions = await this.deps.agentRepository.listActiveVersions(ctx);
    const matching = activeVersions.filter((v) => v.definition.capabilities.includes(capabilityId));
    if (matching.length === 0) {
      throw new Error(`No active agent supports capability ${capabilityId}`);
    }
    if (matching.length > 1) {
      throw new AmbiguousCapabilityError(capabilityId);
    }
    return this.mapToResolvedAgent(matching[0]);
  }

  private mapToResolvedAgent(version: AgentVersion): ResolvedAgent {
    const contract: AgentContract = {
      ...version.definition,
      agentId: version.agentId,
      lifecycle: version.lifecycle,
      version: version.version,
    };
    return toResolvedAgent(contract, version.implementationKey, version.isSystem, version.tenantId);
  }
}

export interface ControlPlanePolicyClientDependencies {
  readonly policyEvaluationService: PolicyEvaluationService;
}

export class ControlPlanePolicyClient implements IPolicyClient {
  constructor(private readonly deps: ControlPlanePolicyClientDependencies) {}

  async evaluate(ctx: TenantContext, request: AIExecutionRequest): Promise<PolicyDecision> {
    return this.deps.policyEvaluationService.evaluate(ctx, request);
  }
}
