import { asTenantId } from '@projectx/shared';
import { asCorrelationId, asIdempotencyKey } from '@projectx/shared';
import type { AIExecutionRequest, AgentContract, MissionContract, PlanContract } from '@projectx/shared';
import { toResolvedAgent } from '../agent-executor/resolved-agent';
import type { ResolvedAgent } from '../agent-executor/resolved-agent';

export const tenantId = asTenantId('tenant-1');
export const otherTenantId = asTenantId('tenant-2');

export function baseExecution(overrides: Partial<AIExecutionRequest> = {}): AIExecutionRequest {
  return {
    executionId: 'exec-1',
    tenantId,
    missionId: 'mission-1',
    agentId: 'agent-1',
    agentVersion: '1.0.0',
    taskId: 'task-1',
    taskType: 'research',
    correlationId: asCorrelationId('corr-1'),
    context: {
      mission: { objective: 'find qualified prospects' },
      target: { companySize: '50-200' },
      constraints: [{ noContactDomains: ['acme.com'] }],
    },
    capabilities: ['research'],
    policyContext: {
      autonomyLevel: 3,
      riskCategory: 'MEDIUM',
      tenantPolicyVersion: 'v1',
      missionPolicyVersion: 'v1',
    },
    budget: {
      maxTokens: 1000,
      maxCostUsd: 0.5,
      maxDurationSeconds: 60,
    },
    idempotencyKey: asIdempotencyKey('idem-1'),
    metadata: {},
    ...overrides,
  };
}

export function activeAgent(overrides: Partial<ResolvedAgent> = {}): ResolvedAgent {
  const now = new Date();
  const { capabilities, tools, lifecycle, ...resolvedOverrides } = overrides as any;
  const resolvedLifecycle = lifecycle ?? 'ACTIVE';
  const contract: AgentContract = {
    agentId: 'agent-1',
    name: 'Research Specialist',
    role: 'researcher',
    description: 'Researches target accounts',
    capabilities: capabilities ?? ['research'],
    tools: tools ?? ['web_search'],
    policies: [],
    modelPolicy: {
      preferredModelFamily: 'gpt-4o',
      maxCostPerTaskUsd: 0.5,
      maxTokensPerTask: 1000,
    },
    memoryPolicy: { read: ['working'], write: [], validationRequired: true },
    knowledgePolicy: { read: ['global'], write: [] },
    autonomyLevelDefault: 3,
    evaluationPolicy: { criteria: ['accuracy'], minScore: 0.8 },
    lifecycle: resolvedLifecycle,
    owner: 'owner-1',
    version: '1.0.0',
    createdAt: now,
    updatedAt: now,
  };
  const base = toResolvedAgent(contract, 'fake.agent.v1', false, tenantId as string);
  return {
    ...base,
    ...resolvedOverrides,
    contract: { ...base.contract, ...resolvedOverrides },
  };
}

export function sampleMission(overrides: Partial<MissionContract> = {}): MissionContract {
  return {
    missionId: 'mission-1',
    tenantId,
    name: 'Q3 Prospecting',
    objective: 'find qualified prospects',
    icpId: 'icp-1',
    territory: ['US'],
    channels: ['email', 'linkedin'],
    budget: { maxAiCostUsd: 10 },
    autonomyLevel: 3,
    constraints: { noContactDomains: ['acme.com'] },
    successCriteria: { targetMeetings: 5 },
    ownerUserId: 'user-1',
    status: 'APPROVED',
    plan: emptyPlan(),
    tasks: [],
    approvals: [],
    outcomes: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function emptyPlan(): PlanContract {
  return {
    planId: 'plan-1',
    missionId: 'mission-1',
    version: 1,
    objectives: [],
    phases: [],
    approvalGates: [],
    fallbackBranches: [],
  };
}
