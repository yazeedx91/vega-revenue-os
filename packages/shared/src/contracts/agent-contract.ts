/**
 * Agent contract type used across API, execution, and integration contracts.
 * Aligned with docs/technology/17-agent-contract.md.
 */
export interface AgentContract {
  agentId: string;
  name: string;
  role: string;
  description: string;
  capabilities: string[];
  tools: string[];
  policies: PolicyReference[];
  modelPolicy: ModelPolicy;
  memoryPolicy: MemoryPolicy;
  knowledgePolicy: KnowledgePolicy;
  autonomyLevelDefault: number;
  evaluationPolicy: EvaluationPolicy;
  lifecycle: AgentLifecycle;
  owner: string;
  version: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Capability {
  capabilityId: string;
  name: string;
  description: string;
  riskCategory: string;
  allowedTools: string[];
  requiredPolicies: string[];
}

export interface PolicyReference {
  policyId: string;
  version: string;
}

export interface ModelPolicy {
  preferredModelFamily: string;
  maxCostPerTaskUsd: number;
  maxTokensPerTask: number;
}

export interface MemoryPolicy {
  read: string[];
  write: string[];
  validationRequired: boolean;
}

export interface KnowledgePolicy {
  read: string[];
  write: string[];
}

export interface EvaluationPolicy {
  criteria: string[];
  minScore: number;
}

export type AgentLifecycle =
  | 'DRAFT'
  | 'TESTING'
  | 'APPROVED'
  | 'ACTIVE'
  | 'DEPRECATED'
  | 'RETIRED';
