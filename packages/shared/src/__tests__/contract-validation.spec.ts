import type { AIExecutionRequest } from '../contracts/ai-execution-contract';
import type { MissionContract } from '../contracts/mission-contract';
import { asTenantId } from '../types/tenant-id';
import { asCorrelationId, asIdempotencyKey } from '../types/correlation';

describe('Contract validation', () => {
  it('AIExecutionRequest requires the approved fields', () => {
    const request: AIExecutionRequest = {
      executionId: 'exec-1',
      tenantId: asTenantId('tenant-1'),
      missionId: 'mission-1',
      agentId: 'agent-1',
      agentVersion: '1.0.0',
      taskId: 'task-1',
      taskType: 'ResearchCompany',
      correlationId: asCorrelationId('corr-1'),
      context: {
        mission: { objective: 'Expand manufacturing' },
        constraints: ['budget < 500'],
      },
      capabilities: ['ResearchCompany'],
      policyContext: {
        autonomyLevel: 3,
        riskCategory: 'LOW',
        tenantPolicyVersion: '1.0.0',
        missionPolicyVersion: '1.0.0',
      },
      budget: {
        maxTokens: 10000,
        maxCostUsd: 0.5,
        maxDurationSeconds: 60,
      },
      idempotencyKey: asIdempotencyKey('idem-1'),
    };

    expect(request.taskType).toBe('ResearchCompany');
    expect(request.budget.maxCostUsd).toBe(0.5);
    expect(request.idempotencyKey).toBe('idem-1');
    expect(request.policyContext.autonomyLevel).toBe(3);
  });

  it('MissionContract includes ICP, territory, channels and success criteria', () => {
    const mission: MissionContract = {
      missionId: 'm-1',
      tenantId: asTenantId('tenant-1'),
      name: 'Q3 Manufacturing Expansion',
      objective: 'Generate qualified opportunities in manufacturing',
      icpId: 'icp-1',
      territory: ['US', 'Canada'],
      channels: ['email'],
      budget: { maxAiCostUsd: 500 },
      autonomyLevel: 3,
      constraints: { workingHours: '9-17 EST' },
      successCriteria: { targetMeetings: 10, targetOpportunities: 5 },
      ownerUserId: 'u-1',
      status: 'PLANNING',
      plan: {
        planId: 'p-1',
        missionId: 'm-1',
        version: 1,
        objectives: [],
        phases: [],
        approvalGates: [],
        fallbackBranches: [],
      },
      tasks: [],
      approvals: [],
      outcomes: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(mission.icpId).toBe('icp-1');
    expect(mission.territory).toContain('US');
    expect(mission.successCriteria.targetMeetings).toBe(10);
    expect(mission.budget.maxAiCostUsd).toBe(500);
  });
});
