import type { IAgentExecutor, IAgentRegistry, IPlanner } from '@projectx/ai-runtime';
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

export class StubAgentRegistry implements IAgentRegistry {
  async getAgent(_ctx: TenantContext, agentId: string, _version?: string): Promise<AgentContract | null> {
    if (agentId !== 'agent-1') {
      return null;
    }
    return {
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
    const taskId = `${mission.missionId}-research-task`;
    const phase: PlanPhase = {
      phaseId: `${mission.missionId}-phase-1`,
      name: 'Research',
      tasks: [
        {
          taskId,
          missionId: mission.missionId,
          planId: `${mission.missionId}-plan`,
          agentId: 'agent-1',
          agentVersion: '1.0.0',
          taskType: 'research',
          status: 'PENDING',
          input: { objective: mission.objective },
          dependsOn: [],
          approvalGateId: null,
        },
      ],
    };
    return {
      planId: `${mission.missionId}-plan`,
      missionId: mission.missionId,
      version: 1,
      objectives: [mission.objective],
      phases: [phase],
      approvalGates: [],
      fallbackBranches: [],
    };
  }
}
