import type { AgentContract } from '@projectx/shared';
import { asCorrelationId, asTenantId } from '@projectx/shared';
import type { MissionContract } from '@projectx/shared';
import { OutreachMissionPlanner } from '../planning/outreach-mission-planner';

describe('OutreachMissionPlanner', () => {
  const ctx = { tenantId: asTenantId('tenant-a'), correlationId: asCorrelationId('corr-1') };

  const baseMission = (overrides: Partial<MissionContract> = {}): MissionContract => ({
    missionId: 'm-1',
    tenantId: asTenantId('tenant-a'),
    name: 'Test mission',
    objective: 'outreach to prospects',
    icpId: 'icp-1',
    territory: ['US'],
    channels: ['email'],
    budget: { maxAiCostUsd: 10 },
    autonomyLevel: 0.5,
    constraints: {},
    successCriteria: {},
    ownerUserId: 'owner-1',
    status: 'PLANNING',
    plan: {
      planId: 'plan-0',
      missionId: 'm-1',
      version: 0,
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
    ...overrides,
  });

  const outreachAgent: AgentContract = {
    agentId: 'outreach-orchestrator',
    name: 'Outreach Orchestrator',
    role: 'outreach-coordinator',
    description: '',
    capabilities: ['plan-outreach', 'draft-message', 'execute-send', 'advance-sequence'],
    tools: [],
    policies: [],
    modelPolicy: { preferredModelFamily: 'stub', maxCostPerTaskUsd: 1, maxTokensPerTask: 2000 },
    memoryPolicy: { read: [], write: [], validationRequired: false },
    knowledgePolicy: { read: [], write: [] },
    autonomyLevelDefault: 0.3,
    evaluationPolicy: { criteria: [], minScore: 0 },
    lifecycle: 'ACTIVE',
    owner: 'outreach',
    version: '1.0.0',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('plans outreach phases for an email mission', async () => {
    const planner = new OutreachMissionPlanner();
    const plan = await planner.plan(ctx, {
      mission: baseMission(),
      availableAgents: [outreachAgent],
      correlationId: asCorrelationId('corr-1'),
    });

    expect(plan.missionId).toBe('m-1');
    expect(plan.phases.length).toBeGreaterThanOrEqual(3);
    const taskTypes = plan.phases.flatMap((p) => p.tasks).map((t) => t.taskType);
    expect(taskTypes).toContain('plan-outreach');
    expect(taskTypes).toContain('draft-message');
    expect(taskTypes).toContain('execute-send');
    expect(taskTypes).toContain('advance-sequence');

    const sendTask = plan.phases.flatMap((p) => p.tasks).find((t) => t.taskType === 'execute-send')!;
    expect(sendTask.dependsOn.length).toBeGreaterThan(0);
    expect(sendTask.approvalGateId).toBe('outreach-approval');
  });

  it('refuses to plan non-outreach missions', async () => {
    const planner = new OutreachMissionPlanner();
    await expect(
      planner.plan(ctx, {
        mission: baseMission({ channels: ['voice'], objective: 'research' }),
        availableAgents: [outreachAgent],
        correlationId: asCorrelationId('corr-2'),
      }),
    ).rejects.toThrow('OutreachMissionPlanner can only plan outreach missions');
  });

  it('requires an available outreach agent', async () => {
    const planner = new OutreachMissionPlanner();
    await expect(
      planner.plan(ctx, {
        mission: baseMission(),
        availableAgents: [],
        correlationId: asCorrelationId('corr-3'),
      }),
    ).rejects.toThrow('No outreach agent available');
  });
});
