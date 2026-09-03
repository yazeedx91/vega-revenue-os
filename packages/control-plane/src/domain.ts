import type { AgentContract } from '@projectx/shared';

/**
 * Lifecycle states for an agent version.
 */
export type AgentLifecycle =
  | 'DRAFT'
  | 'TESTING'
  | 'APPROVED'
  | 'ACTIVE'
  | 'DEPRECATED'
  | 'RETIRED';

const ALLOWED_TRANSITIONS: Record<AgentLifecycle, AgentLifecycle[]> = {
  DRAFT: ['TESTING'],
  TESTING: ['APPROVED', 'DEPRECATED'],
  APPROVED: ['ACTIVE', 'DEPRECATED'],
  ACTIVE: ['DEPRECATED'],
  DEPRECATED: ['RETIRED'],
  RETIRED: [],
};

export function canTransitionAgentLifecycle(
  from: AgentLifecycle,
  to: AgentLifecycle,
): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isMutableAgentLifecycle(lifecycle: AgentLifecycle): boolean {
  return lifecycle === 'DRAFT' || lifecycle === 'TESTING';
}

export class ImmutableAgentVersionConflict extends Error {
  constructor(
    public readonly agentId: string,
    public readonly version: string,
    public readonly reason: string,
  ) {
    super(`Immutable version conflict for ${agentId}@${version}: ${reason}`);
    this.name = 'ImmutableAgentVersionConflict';
  }
}

export interface AgentVersion {
  readonly versionId: string;
  readonly agentId: string;
  readonly tenantId: string | null;
  readonly isSystem: boolean;
  readonly version: string;
  readonly lifecycle: AgentLifecycle;
  readonly implementationKey: string;
  readonly definition: AgentContract;
}

export type PolicyOutcome = 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';

export interface PolicyRule {
  readonly policyId: string;
  readonly tenantId: string | null;
  readonly scope: 'system' | 'tenant' | 'mission' | 'agent' | 'action';
  readonly missionId?: string | null;
  readonly agentId?: string | null;
  readonly capability?: string | null;
  readonly toolId?: string | null;
  readonly riskCategory?: string | null;
  readonly outcome: PolicyOutcome;
  readonly policyVersion: string;
  readonly priority: number;
}

export interface AutonomyRule {
  readonly ruleId: string;
  readonly tenantId: string;
  readonly level: number;
  readonly riskCategory: string;
  readonly requiredOutcome: PolicyOutcome;
  readonly confidenceThreshold: number;
}

export interface Capability {
  readonly capabilityId: string;
  readonly name: string;
  readonly description: string;
  readonly riskCategory: string;
  readonly allowedTools: string[];
  readonly requiredPolicies: string[];
}

export interface Model {
  readonly modelId: string;
  readonly provider: string;
  readonly family: string;
  readonly capabilities: string[];
  readonly latencyClass: string;
  readonly costMetadata: Record<string, unknown>;
  readonly healthMetadata: Record<string, unknown>;
}

const OUTCOME_PRECEDENCE: Record<PolicyOutcome, number> = {
  DENY: 2,
  REQUIRE_APPROVAL: 1,
  ALLOW: 0,
};

/**
 * Returns the more restrictive of two outcomes.
 * Safety-monotonic: cannot relax a higher-level restriction.
 */
export function tightenOutcome(
  a: PolicyOutcome,
  b: PolicyOutcome,
): PolicyOutcome {
  return OUTCOME_PRECEDENCE[a] >= OUTCOME_PRECEDENCE[b] ? a : b;
}

const SCOPE_ORDER: Record<PolicyRule['scope'], number> = {
  system: 0,
  tenant: 1,
  mission: 2,
  agent: 3,
  action: 4,
};

/**
 * Merges policy outcomes from multiple scopes into a single ceiling.
 * More specific scopes may tighten authority but never loosen an applicable
 * higher-level non-bypassable ceiling.
 */
export function mergePolicyOutcomes(
  rules: Pick<PolicyRule, 'scope' | 'outcome'>[],
): PolicyOutcome {
  const sorted = [...rules].sort(
    (a, b) => SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope],
  );
  let ceiling: PolicyOutcome = 'ALLOW';
  for (const rule of sorted) {
    ceiling = tightenOutcome(ceiling, rule.outcome);
  }
  return ceiling;
}

/**
 * Maps an autonomy level 0–5 and risk category to an outcome ceiling,
 * given an existing policy ceiling. Never expands authority.
 *
 * Reference: docs/ai/21-autonomy-architecture.md
 */
export function evaluateAutonomy(
  level: number,
  riskCategory: string,
  confidence: number,
  policyCeiling: PolicyOutcome,
): PolicyOutcome {
  if (policyCeiling === 'DENY') {
    return 'DENY';
  }

  if (level < 0 || level > 5 || !Number.isInteger(level)) {
    // Unknown/malformed autonomy is treated as the most restrictive.
    return 'DENY';
  }

  const highRisk = new Set(['HIGH', 'CRITICAL']);
  if (highRisk.has(riskCategory.toUpperCase()) && level < 4) {
    return tightenOutcome(policyCeiling, 'REQUIRE_APPROVAL');
  }

  if (level < 2) {
    return tightenOutcome(policyCeiling, 'REQUIRE_APPROVAL');
  }

  if (confidence < 0.5) {
    return tightenOutcome(policyCeiling, 'REQUIRE_APPROVAL');
  }

  return policyCeiling;
}

export function isActiveAgentVersion(version: AgentVersion): boolean {
  return version.lifecycle === 'ACTIVE';
}

