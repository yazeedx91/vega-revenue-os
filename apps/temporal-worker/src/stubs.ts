import type { IAgentExecutor, IAgentRegistry, IPlanner } from '@projectx/ai-runtime';
import { toResolvedAgent } from '@projectx/ai-runtime';
import type { TenantContext } from '@projectx/domain';
import type {
  AgentContract,
  AIExecutionRequest,
  AIExecutionResult,
  MissionContract,
  PlanContract,
  PlanPhase,
} from '@projectx/shared';
import type { PlanningRequest } from '@projectx/ai-runtime';

export class StubAgentExecutor implements IAgentExecutor {
  async execute(request: AIExecutionRequest): Promise<AIExecutionResult> {
    return {
      executionId: request.executionId,
      tenantId: request.tenantId,
      missionId: request.missionId,
      status: 'COMPLETED',
      outcome: {
        summary: 'Stub execution completed',
        decisions: [],
        actions: [],
        evidence: [],
      },
      modelUsage: {
        model: 'stub',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      },
      startedAt: new Date(),
      completedAt: new Date(),
      correlationId: request.correlationId,
      events: ['AgentExecutionCompleted'],
    };
  }
}

const stubAgentContract: AgentContract = {
  agentId: 'agent-1',
  version: '1.0.0',
  name: 'Stub Agent',
  role: 'researcher',
  description: 'Stub agent for worker scaffolding',
  capabilities: ['research'],
  tools: [],
  policies: [],
  modelPolicy: { preferredModelFamily: 'stub', maxCostPerTaskUsd: 1, maxTokensPerTask: 1000 },
  memoryPolicy: { read: [], write: [], validationRequired: false },
  knowledgePolicy: { read: [], write: [] },
  autonomyLevelDefault: 0.5,
  evaluationPolicy: { criteria: [], minScore: 0 },
  lifecycle: 'ACTIVE',
  owner: 'system',
  createdAt: new Date(),
  updatedAt: new Date(),
};

export class StubAgentRegistry implements IAgentRegistry {
  async getAgent(_ctx: TenantContext, agentId: string, _version?: string) {
    if (agentId !== 'agent-1') {
      return null;
    }
    return toResolvedAgent(stubAgentContract, 'stub.agent.v1');
  }

  async getCapability(_tenantId: string, _capabilityId: string): Promise<{
    capabilityId: string;
    allowedTools: string[];
  } | null> {
    return { capabilityId: 'research', allowedTools: [] };
  }
}

export class StubMissionPlanner implements IPlanner {
  async plan(_ctx: TenantContext, request: PlanningRequest): Promise<PlanContract> {
    const mission = request.mission;
    const previousVersion = mission.plan?.version ?? 0;
    const version = previousVersion > 0 ? previousVersion + 1 : 1;
    const planId = `${mission.missionId}-plan-v${version}`;
    const taskId = `${mission.missionId}-research-task`;
    const phase: PlanPhase = {
      phaseId: `${mission.missionId}-phase-v${version}`,
      name: 'Research',
      tasks: [
        {
          taskId,
          missionId: mission.missionId,
          planId,
          agentId: 'agent-1',
          agentVersion: '1.0.0',
          taskType: 'research',
          status: 'PENDING',
          input: {
            researchScope: 'company',
            companyName: mission.name,
            domain: mission.objective,
          },
          dependsOn: [],
          approvalGateId: null,
        },
      ],
    };
    return {
      planId,
      missionId: mission.missionId,
      version,
      objectives: [mission.objective],
      phases: [phase],
      approvalGates: [],
      fallbackBranches: [],
    };
  }
}
