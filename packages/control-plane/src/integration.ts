import type { TenantContext } from '@projectx/domain';
import { asCorrelationId, asTenantId } from '@projectx/shared';
import type { AgentContract } from '@projectx/shared';
import type { IAgentRegistry, IPolicyClient, PolicyDecision } from '@projectx/ai-runtime';
import type { AIExecutionRequest } from '@projectx/shared';
import type { PolicyEvaluationService } from './application';
import type { IAgentRepository, ICapabilityRepository } from './ports';

export interface ControlPlaneAgentRegistryDependencies {
  readonly agentRepository: IAgentRepository;
  readonly capabilityRepository: ICapabilityRepository;
}

export interface ControlPlaneRegistryCapability {
  readonly capabilityId: string;
  readonly allowedTools: string[];
}

export class ControlPlaneAgentRegistry implements IAgentRegistry {
  constructor(private readonly deps: ControlPlaneAgentRegistryDependencies) {}

  async getAgent(
    ctx: TenantContext,
    agentId: string,
    version?: string,
  ): Promise<AgentContract | null> {
    const activeVersion = await this.deps.agentRepository.getActiveVersion(ctx, agentId, version);
    if (!activeVersion) return null;
    return activeVersion.definition;
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
