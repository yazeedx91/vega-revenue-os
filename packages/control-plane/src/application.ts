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
  isMutableAgentLifecycle,
  ImmutableAgentVersionConflict,
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

function safeJson(a: unknown): string {
  return JSON.stringify(a, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a as string).localeCompare(b as string)));
    }
    return v;
  }) ?? '';
}

function areVersionDefinitionsEqual(a: AgentVersion, b: AgentVersion): string | null {
  if (a.implementationKey !== b.implementationKey) return `implementationKey: ${a.implementationKey} != ${b.implementationKey}`;
  if (a.tenantId !== b.tenantId) return `tenantId: ${a.tenantId} != ${b.tenantId}`;
  if (a.isSystem !== b.isSystem) return `isSystem: ${a.isSystem} != ${b.isSystem}`;
  const ad = a.definition;
  const bd = b.definition;
  if (ad.name !== bd.name) return `name: ${ad.name} != ${bd.name}`;
  if (ad.role !== bd.role) return `role: ${ad.role} != ${bd.role}`;
  if (ad.description !== bd.description) return `description: ${ad.description} != ${bd.description}`;
  if (safeJson(ad.capabilities) !== safeJson(bd.capabilities)) return `capabilities: ${safeJson(ad.capabilities)} != ${safeJson(bd.capabilities)}`;
  if (safeJson(ad.tools) !== safeJson(bd.tools)) return `tools: ${safeJson(ad.tools)} != ${safeJson(bd.tools)}`;
  if (safeJson(ad.policies) !== safeJson(bd.policies)) return `policies: ${safeJson(ad.policies)} != ${safeJson(bd.policies)}`;
  if (safeJson(ad.modelPolicy) !== safeJson(bd.modelPolicy)) return `modelPolicy: ${safeJson(ad.modelPolicy)} != ${safeJson(bd.modelPolicy)}`;
  if (safeJson(ad.memoryPolicy) !== safeJson(bd.memoryPolicy)) return `memoryPolicy: ${safeJson(ad.memoryPolicy)} != ${safeJson(bd.memoryPolicy)}`;
  if (safeJson(ad.knowledgePolicy) !== safeJson(bd.knowledgePolicy)) return `knowledgePolicy: ${safeJson(ad.knowledgePolicy)} != ${safeJson(bd.knowledgePolicy)}`;
  if (ad.autonomyLevelDefault !== bd.autonomyLevelDefault) return `autonomyLevelDefault: ${ad.autonomyLevelDefault} != ${bd.autonomyLevelDefault}`;
  if (safeJson(ad.evaluationPolicy) !== safeJson(bd.evaluationPolicy)) return `evaluationPolicy: ${safeJson(ad.evaluationPolicy)} != ${safeJson(bd.evaluationPolicy)}`;
  if (ad.owner !== bd.owner) return `owner: ${ad.owner} != ${bd.owner}`;
  return null;
}

export class ControlPlaneService {
  constructor(private readonly deps: ControlPlaneServiceDependencies) {}

  async registerAgentVersion(ctx: TenantContext, version: AgentVersion): Promise<void> {
    const existing = await this.deps.agentRepository.getActiveVersion(
      ctx,
      version.agentId,
      version.version,
    );
    if (existing) {
      const diff = areVersionDefinitionsEqual(existing, version);
      if (diff === null) {
        await this.deps.auditSink.record(ctx, 'agent-registered', 'success', {
          agentId: version.agentId,
          version: version.version,
          lifecycle: existing.lifecycle,
          idempotent: true,
        });
        return;
      }
      if (!isMutableAgentLifecycle(existing.lifecycle)) {
        throw new ImmutableAgentVersionConflict(
          version.agentId,
          version.version,
          diff + ' in ' + existing.lifecycle + ' version',
        );
      }
    }
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
