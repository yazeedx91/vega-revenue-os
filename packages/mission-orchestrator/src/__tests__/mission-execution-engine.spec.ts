import { MissionExecutionEngine } from '../workflow/mission-execution-engine';
import { ApprovalApplicationService, InMemoryApprovalRepository, InMemoryCompensationAdapter, InMemoryMissionRepository, InMemoryNotificationAdapter } from '..';
import {
  createCorrelationIdGenerator,
  createIdempotencyKeyGenerator,
  createMissionIdGenerator,
  createTenantContext,
  createTestMission,
  FakeAgentExecutor,
  FakeAgentRegistry,
  FakeEventBus,
  FakePlanner,
  FakeWorkflowClient,
} from './test-doubles';

describe('MissionExecutionEngine', () => {
  let missionRepository: InMemoryMissionRepository;
  let approvalRepository: InMemoryApprovalRepository;
  let notificationPort: InMemoryNotificationAdapter;
  let compensationPort: InMemoryCompensationAdapter;
  let eventBus: FakeEventBus;
  let agentExecutor: FakeAgentExecutor;
  let engine: MissionExecutionEngine;
  let workflowClient: FakeWorkflowClient;

  beforeEach(() => {
    missionRepository = new InMemoryMissionRepository();
    approvalRepository = new InMemoryApprovalRepository();
    notificationPort = new InMemoryNotificationAdapter();
    compensationPort = new InMemoryCompensationAdapter();
    eventBus = new FakeEventBus();
    agentExecutor = new FakeAgentExecutor();
    workflowClient = new FakeWorkflowClient();

    const generateEventId = createMissionIdGenerator();
    const generateCorrelationId = createCorrelationIdGenerator();
    const generateIdempotencyKey = createIdempotencyKeyGenerator();

    const approvalService = new ApprovalApplicationService({
      approvalRepository,
      missionRepository,
      workflowClient,
      notificationPort,
      generateEventId,
      generateCorrelationId,
      generateApprovalId: () => `approval-${++seed}`,
    });

    engine = new MissionExecutionEngine({
      missionRepository,
      agentExecutor,
      missionPlanner: new FakePlanner(),
      agentRegistry: new FakeAgentRegistry(),
      approvalService,
      eventBus,
      compensationPort,
      missionWorkspaceResolver: { resolveAuthorizedWorkspace: async () => '00000000-0000-4000-8000-000000000001' },
      generateEventId,
      generateCorrelationId,
      generateIdempotencyKey,
      generateExecutionId: () => `exec-${++seed}`,
      defaultTaskTimeoutSeconds: 60,
      maxTaskRetries: 3,
    });
  });

  let seed = 0;
  beforeEach(() => {
    seed = 0;
  });

  it('plans and completes a mission with dependent tasks', async () => {
    const mission = createTestMission({ status: 'PLANNING' });
    const ctx = createTenantContext('tenant-1', 'corr-1');
    await missionRepository.save(ctx, mission);
    await engine.executeMission(ctx, mission.id as string);

    const updated = await missionRepository.findById(ctx, mission.id as string);
    expect(updated?.status).toBe('COMPLETED');
    expect(updated?.tasks).toHaveLength(2);
    expect(updated?.tasks.every((t) => t.status === 'COMPLETED')).toBe(true);
    expect(eventBus.published.some((e) => e.eventType === 'MissionCompleted')).toBe(true);
  });

  it('blocks mission when a task fails and invokes compensation', async () => {
    const mission = createTestMission({ status: 'PLANNING' });
    const ctx = createTenantContext('tenant-1', 'corr-1');
    await missionRepository.save(ctx, mission);
    agentExecutor.setStatus('FAILED');
    await engine.executeMission(ctx, mission.id as string);

    const updated = await missionRepository.findById(ctx, mission.id as string);
    expect(updated?.status).toBe('BLOCKED');
    expect(compensationPort.executed.length).toBeGreaterThan(0);
    expect(eventBus.published.some((e) => e.eventType === 'MissionBlocked')).toBe(true);
  });

  it('pauses mission when a task awaits approval', async () => {
    const mission = createTestMission({ status: 'PLANNING' });
    const ctx = createTenantContext('tenant-1', 'corr-1');
    await missionRepository.save(ctx, mission);
    agentExecutor.setStatus('AWAITING_APPROVAL');
    await engine.executeMission(ctx, mission.id as string);

    const updated = await missionRepository.findById(ctx, mission.id as string);
    expect(updated?.status).toBe('PAUSED');
    expect(notificationPort.requests.length).toBe(1);
    expect(workflowClient.signaled.length).toBe(0);
  });

  it('throws on cross-tenant task execution', async () => {
    const ctx1 = createTenantContext('tenant-1', 'corr-1');
    const mission = createTestMission({ tenantId: 'tenant-1', status: 'PLANNING' });
    await missionRepository.save(ctx1, mission);

    const ctx = createTenantContext('tenant-2', 'corr-1');
    await expect(engine.executeMission(ctx, mission.id as string)).rejects.toThrow();
  });

  it('replans an executing mission with a higher plan version', async () => {
    const ctx = createTenantContext('tenant-1', 'corr-1');
    const mission = createTestMission({ status: 'PLANNING' });
    await missionRepository.save(ctx, mission);

    await engine.planMission(ctx, mission.id as string);
    await engine.replanMission(ctx, mission.id as string);

    const updated = await missionRepository.findById(ctx, mission.id as string);
    expect(updated?.plan.version).toBe(3);
    expect(updated?.tasks).toHaveLength(2);
    expect(eventBus.published.some((e) => e.eventType === 'MissionReplanned')).toBe(true);
  });

  it('rejects replan with a lower or equal plan version', async () => {
    const ctx = createTenantContext('tenant-1', 'corr-1');
    const mission = createTestMission({ status: 'PLANNING' });
    await missionRepository.save(ctx, mission);

    await engine.planMission(ctx, mission.id as string);

    const invalidPlan: import('@projectx/shared').PlanContract = {
      planId: `${mission.id as string}-plan-0`,
      missionId: mission.id as string,
      version: 0,
      objectives: [],
      phases: [
        {
          phaseId: `${mission.id as string}-phase-0`,
          name: 'Bad',
          tasks: [
            {
              taskId: `${mission.id as string}-task-0`,
              missionId: mission.id as string,
              planId: `${mission.id as string}-plan-0`,
              agentId: 'agent-1',
              agentVersion: '1.0.0',
              taskType: 'research',
              requiredCapability: 'research',
              status: 'PENDING',
              input: {},
              dependsOn: [],
              approvalGateId: null,
            },
          ],
        },
      ],
      approvalGates: [],
      fallbackBranches: [],
    };

    await expect(engine.replanMission(ctx, mission.id as string, invalidPlan)).rejects.toThrow(/version/);
  });

  it('rejects a plan whose required capability is not supported by the selected agent', async () => {
    const ctx = createTenantContext('tenant-1', 'corr-1');
    const mission = createTestMission({ status: 'PLANNING' });
    await missionRepository.save(ctx, mission);

    await engine.planMission(ctx, mission.id as string);

    const badPlan: import('@projectx/shared').PlanContract = {
      planId: `${mission.id as string}-plan-bad`,
      missionId: mission.id as string,
      version: 3,
      objectives: [],
      phases: [
        {
          phaseId: `${mission.id as string}-phase-bad`,
          name: 'Bad',
          tasks: [
            {
              taskId: `${mission.id as string}-task-bad`,
              missionId: mission.id as string,
              planId: `${mission.id as string}-plan-bad`,
              agentId: 'agent-1',
              agentVersion: '1.0.0',
              taskType: 'research',
              requiredCapability: 'unsupported-capability',
              status: 'PENDING',
              input: {},
              dependsOn: [],
              approvalGateId: null,
            },
          ],
        },
      ],
      approvalGates: [],
      fallbackBranches: [],
    };

    await expect(engine.replanMission(ctx, mission.id as string, badPlan)).rejects.toThrow(/capability/);
  });
});
