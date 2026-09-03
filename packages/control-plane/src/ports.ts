import type { TenantContext } from '@projectx/domain';
import type { AgentContract, AIExecutionRequest } from '@projectx/shared';
import type { PolicyDecision } from '@projectx/ai-runtime';
import type {
  AgentVersion,
  AutonomyRule,
  Capability,
  Model,
  PolicyRule,
  PolicyOutcome,
} from './domain';

export interface IAgentRepository {
  getActiveVersion(
    ctx: TenantContext,
    agentId: string,
    version?: string,
  ): Promise<AgentVersion | null>;
  listActiveVersions(ctx: TenantContext): Promise<AgentVersion[]>;
  saveVersion(ctx: TenantContext, version: AgentVersion): Promise<void>;
  transitionLifecycle(
    ctx: TenantContext,
    agentId: string,
    version: string,
    from: AgentVersion['lifecycle'],
    to: AgentVersion['lifecycle'],
  ): Promise<void>;
}

export interface ICapabilityRepository {
  getGlobalCapability(
    ctx: TenantContext,
    capabilityId: string,
  ): Promise<Capability | null>;
  listGlobalCapabilities(ctx: TenantContext): Promise<Capability[]>;
  saveCapability(ctx: TenantContext, capability: Capability): Promise<void>;
}

export interface IModelRepository {
  getModel(ctx: TenantContext, modelId: string): Promise<Model | null>;
  listModels(ctx: TenantContext): Promise<Model[]>;
  saveModel(ctx: TenantContext, model: Model): Promise<void>;
}

export interface IPolicyRepository {
  findRules(ctx: TenantContext, request: AIExecutionRequest): Promise<PolicyRule[]>;
  saveRule(ctx: TenantContext, rule: PolicyRule): Promise<void>;
}

export interface IAutonomyRepository {
  getRule(
    ctx: TenantContext,
    level: number,
    riskCategory: string,
  ): Promise<AutonomyRule | null>;
  saveRule(ctx: TenantContext, rule: AutonomyRule): Promise<void>;
}

export interface IEmergencyStopProvider {
  isStopped(
    ctx: TenantContext,
    target: { scope: 'tenant' | 'mission' | 'agent'; targetId?: string },
  ): Promise<boolean>;
}

export interface IAuditSink {
  record(
    ctx: TenantContext,
    event: string,
    outcome: 'success' | 'denied' | 'failure',
    metadata: Record<string, unknown>,
  ): Promise<void>;
}

export type { PolicyOutcome, PolicyDecision };
