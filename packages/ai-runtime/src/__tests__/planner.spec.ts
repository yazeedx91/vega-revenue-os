import { MissionPlanner, PlannerError } from '@projectx/ai-runtime';
import type { AgentContract, MissionContract } from '@projectx/shared';
import { sampleMission, tenantId } from './fixtures';

describe('MissionPlanner', () => {
  const baseAgents: AgentContract[] = [
    {
      agentId: 'agent-research',
      name: 'Researcher',
      role: 'researcher',
      description: '',
      capabilities: ['research'],
      tools: ['web_search'],
      policies: [],
      modelPolicy: { preferredModelFamily: 'fake', maxCostPerTaskUsd: 1, maxTokensPerTask: 1000 },
      memoryPolicy: { read: [], write: [], validationRequired: true },
      knowledgePolicy: { read: [], write: [] },
      autonomyLevelDefault: 3,
      evaluationPolicy: { criteria: [], minScore: 0 },
      lifecycle: 'ACTIVE',
      owner: 'owner',
      version: '1',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  function buildPlanner() {
    return new MissionPlanner({
      phaseTemplates: [
        {
          phaseId: 'research',
          name: 'Research Phase',
          capability: 'research',
          requiredWhen: (mission) => mission.objective.includes('prospects'),
          dependencies: [],
          taskType: 'research',
        },
        {
          phaseId: 'enrich',
          name: 'Enrich Phase',
          capability: 'enrich',
          requiredWhen: (mission) => mission.channels.includes('email'),
          dependencies: ['research'],
          taskType: 'enrich',
        },
      ],
    });
  }

  it('decomposes a mission into phases with dependencies', async () => {
    const planner = buildPlanner();
    const agents: AgentContract[] = [
      ...baseAgents,
      {
        agentId: 'agent-enrich',
        name: 'Enricher',
        role: 'enricher',
        description: '',
        capabilities: ['enrich'],
        tools: ['enrich_tool'],
        policies: [],
        modelPolicy: { preferredModelFamily: 'fake', maxCostPerTaskUsd: 1, maxTokensPerTask: 1000 },
        memoryPolicy: { read: [], write: [], validationRequired: true },
        knowledgePolicy: { read: [], write: [] },
        autonomyLevelDefault: 3,
        evaluationPolicy: { criteria: [], minScore: 0 },
        lifecycle: 'ACTIVE',
        owner: 'owner',
        version: '1',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = await planner.plan(
      { tenantId, correlationId: 'corr-1' as any },
      { mission: sampleMission(), availableAgents: agents, correlationId: 'corr-1' as any },
    );

    expect(result.phases).toHaveLength(2);
    expect(result.phases[0].tasks[0].taskType).toBe('research');
    expect(result.phases[1].tasks[0].dependsOn).toContain(
      `${result.missionId}-research-task`,
    );
  });

  it('throws when no applicable phase templates match', async () => {
    const planner = new MissionPlanner({ phaseTemplates: [] });
    await expect(
      planner.plan(
        { tenantId, correlationId: 'corr-1' as any },
        { mission: sampleMission(), availableAgents: baseAgents, correlationId: 'corr-1' as any },
      ),
    ).rejects.toBeInstanceOf(PlannerError);
  });

  it('throws when required capability is missing from available agents', async () => {
    const planner = buildPlanner();
    await expect(
      planner.plan(
        { tenantId, correlationId: 'corr-1' as any },
        { mission: sampleMission(), availableAgents: [], correlationId: 'corr-1' as any },
      ),
    ).rejects.toBeInstanceOf(PlannerError);
  });

  it('throws when mission tenant does not match context tenant', async () => {
    const planner = buildPlanner();
    const mission: MissionContract = { ...sampleMission(), tenantId: 'other-tenant' as any };
    await expect(
      planner.plan(
        { tenantId, correlationId: 'corr-1' as any },
        { mission, availableAgents: baseAgents, correlationId: 'corr-1' as any },
      ),
    ).rejects.toBeInstanceOf(PlannerError);
  });
});
