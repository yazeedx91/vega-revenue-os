import type { TenantContext } from '@projectx/domain';
import { ensureSameTenant } from '@projectx/domain';
import type { AIExecutionRequest } from '@projectx/shared';
import type { PolicyDecision } from '@projectx/ai-runtime';
import { randomUUID } from 'crypto';
import {
  canTransitionAgentLifecycle,
  evaluateAutonomy,
  mergePolicyOutcomes,
  tightenOutcome,
  type AgentVersion,
  type AutonomyRule,
  type Capability,
  type Model,
  type PolicyOutcome,
  type PolicyRule,
} from './domain';
import type {
  IAgentRepository,
  IAuditSink,
  IAutonomyRepository,
  ICapabilityRepository,
  IEmergencyStopProvider,
  IModelRepository,
  IPolicyRepository,
} from './ports';

export interface PolicyEvaluationServiceDependencies {
  readonly emergencyStopProvider: IEmergencyStopProvider;
  readonly policyRepository: IPolicyRepository;
  readonly autonomyRepository: IAutonomyRepository;
  readonly auditSink: IAuditSink;
}

export class PolicyEvaluationService {
  constructor(private readonly deps: PolicyEvaluationServiceDependencies) {}

  async evaluate(
    ctx: TenantContext,
    request: AIExecutionRequest,
  ): Promise<PolicyDecision> {
    ensureSameTenant(ctx, request.tenantId);
    const decisionId = randomUUID();
    const evaluatedAt = new Date();
    const expiresAt = new Date(evaluatedAt.getTime() + 60_000);

    const stopTarget = {
      scope: 'tenant' as const,
      targetId: request.tenantId as string,
    };

    let stopped: boolean;
    try {
      stopped = await this.deps.emergencyStopProvider.isStopped(ctx, stopTarget);
    } catch {
      // Fail closed: if the authoritative emergency-stop state cannot be
      // determined, side-effecting execution is denied.
      return this.buildDecision(
        decisionId,
        request,
        'DENY',
        evaluatedAt,
        expiresAt,
        'emergency-stop-state-unknown',
      );
    }

    if (stopped) {
      return this.buildDecision(
        decisionId,
        request,
        'DENY',
        evaluatedAt,
        expiresAt,
        'emergency-stop-active',
      );
    }

    const rules = await this.deps.policyRepository.findRules(ctx, request);
    const policyCeiling =
      rules.length === 0 ? 'ALLOW' : mergePolicyOutcomes(rules);

    const autonomyRule = await this.deps.autonomyRepository.getRule(
      ctx,
      request.policyContext.autonomyLevel,
      request.policyContext.riskCategory,
    );

    const baseOutcome = autonomyRule
      ? evaluateAutonomy(
          request.policyContext.autonomyLevel,
          request.policyContext.riskCategory,
          1.0,
          'ALLOW',
        )
      : evaluateAutonomy(
          request.policyContext.autonomyLevel,
          request.policyContext.riskCategory,
          1.0,
          'ALLOW',
        );

    const targetOutcome = autonomyRule
      ? tightenOutcome(baseOutcome, autonomyRule.requiredOutcome)
      : baseOutcome;
    const finalOutcome = tightenOutcome(policyCeiling, targetOutcome);

    await this.audit(
      ctx,
      'policy-evaluation',
      finalOutcome,
      { decisionId, policyCeiling, rules: rules.map((r) => r.policyId) },
    );

    return this.buildDecision(
      decisionId,
      request,
      finalOutcome,
      evaluatedAt,
      expiresAt,
    );
  }

  private buildDecision(
    decisionId: string,
    request: AIExecutionRequest,
    outcome: PolicyOutcome,
    evaluatedAt: Date,
    expiresAt: Date,
    reason?: string,
  ): PolicyDecision {
    return {
      decisionId,
      tenantId: request.tenantId as string,
      missionId: request.missionId,
      agentId: request.agentId,
      agentVersion: request.agentVersion,
      capability: request.capabilities[0],
      action: request.taskType,
      outcome,
      capabilities: request.capabilities,
      autonomyLevel: request.policyContext.autonomyLevel,
      riskCategory: request.policyContext.riskCategory,
      evaluatedAt,
      expiresAt,
      correlationId: request.correlationId as string,
      executionId: request.executionId,
      policyVersion: reason ?? '1.0.0',
    };
  }

  private async audit(
    ctx: TenantContext,
    action: string,
    outcome: PolicyOutcome,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const result: 'success' | 'denied' | 'failure' =
      outcome === 'ALLOW' ? 'success' : outcome === 'DENY' ? 'denied' : 'failure';
    await this.deps.auditSink.record(ctx, action, result, {
      ...metadata,
      result: outcome,
    });
  }
}

export interface AutonomyEvaluationServiceDependencies {
  readonly autonomyRepository: IAutonomyRepository;
}

export class AutonomyEvaluationService {
  constructor(private readonly deps: AutonomyEvaluationServiceDependencies) {}

  async evaluate(
    ctx: TenantContext,
    level: number,
    riskCategory: string,
    confidence: number,
    policyCeiling: PolicyOutcome,
  ): Promise<PolicyOutcome> {
    const rule = await this.deps.autonomyRepository.getRule(ctx, level, riskCategory);
    const base = evaluateAutonomy(level, riskCategory, confidence, 'ALLOW');
    const target = rule ? tightenOutcome(base, rule.requiredOutcome) : base;
    return tightenOutcome(policyCeiling, target);
  }
}

export interface AgentLifecycleServiceDependencies {
  readonly agentRepository: IAgentRepository;
  readonly auditSink: IAuditSink;
}

export class AgentLifecycleService {
  constructor(private readonly deps: AgentLifecycleServiceDependencies) {}

  async transition(
    ctx: TenantContext,
    agentId: string,
    version: string,
    to: AgentVersion['lifecycle'],
  ): Promise<void> {
    const current = await this.deps.agentRepository.getActiveVersion(ctx, agentId, version);
    if (!current) {
      throw new Error(`Agent version ${agentId}@${version} not found`);
    }
    if (!canTransitionAgentLifecycle(current.lifecycle, to)) {
      throw new Error(
        `Invalid lifecycle transition from ${current.lifecycle} to ${to} for ${agentId}@${version}`,
      );
    }
    await this.deps.agentRepository.transitionLifecycle(
      ctx,
      agentId,
      version,
      current.lifecycle,
      to,
    );
    await this.deps.auditSink.record(ctx, 'agent-lifecycle-transition', 'success', {
      agentId,
      version,
      from: current.lifecycle,
      to,
    });
  }

  async activateVersion(
    ctx: TenantContext,
    agentId: string,
    version: string,
  ): Promise<void> {
    await this.deps.agentRepository.transitionLifecycle(
      ctx,
      agentId,
      version,
      'APPROVED',
      'ACTIVE',
    );
    await this.deps.auditSink.record(ctx, 'agent-activated', 'success', {
      agentId,
      version,
    });
  }
}

export interface ControlPlaneServiceDependencies {
  readonly agentRepository: IAgentRepository;
  readonly capabilityRepository: ICapabilityRepository;
  readonly modelRepository: IModelRepository;
  readonly policyRepository: IPolicyRepository;
  readonly autonomyRepository: IAutonomyRepository;
  readonly auditSink: IAuditSink;
}

export class ControlPlaneService {
  constructor(private readonly deps: ControlPlaneServiceDependencies) {}

  async registerAgentVersion(ctx: TenantContext, version: AgentVersion): Promise<void> {
    await this.deps.agentRepository.saveVersion(ctx, version);
    await this.deps.auditSink.record(ctx, 'agent-registered', 'success', {
      agentId: version.agentId,
      version: version.version,
      lifecycle: version.lifecycle,
    });
  }

  async registerCapability(ctx: TenantContext, capability: Capability): Promise<void> {
    await this.deps.capabilityRepository.saveCapability(ctx, capability);
    await this.deps.auditSink.record(ctx, 'capability-registered', 'success', {
      capabilityId: capability.capabilityId,
    });
  }

  async registerModel(ctx: TenantContext, model: Model): Promise<void> {
    await this.deps.modelRepository.saveModel(ctx, model);
    await this.deps.auditSink.record(ctx, 'model-registered', 'success', {
      modelId: model.modelId,
    });
  }

  async savePolicyRule(ctx: TenantContext, rule: PolicyRule): Promise<void> {
    await this.deps.policyRepository.saveRule(ctx, rule);
    await this.deps.auditSink.record(ctx, 'policy-created', 'success', {
      policyId: rule.policyId,
      scope: rule.scope,
      outcome: rule.outcome,
    });
  }

  async saveAutonomyRule(ctx: TenantContext, rule: AutonomyRule): Promise<void> {
    await this.deps.autonomyRepository.saveRule(ctx, rule);
    await this.deps.auditSink.record(ctx, 'autonomy-configured', 'success', {
      ruleId: rule.ruleId,
      level: rule.level,
      riskCategory: rule.riskCategory,
    });
  }
}
