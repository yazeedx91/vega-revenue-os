import { InMemoryIdempotencyStore, InMemoryMissionRepository, MissionOrchestratorService } from '..';
import {
  createCorrelationIdGenerator,
  createIdempotencyKeyGenerator,
  createMissionIdGenerator,
  createTenantContext,
  createTestMission,
  FakeEventBus,
  FakeWorkflowClient,
} from './test-doubles';

describe('MissionOrchestratorService', () => {
  let missionRepository: InMemoryMissionRepository;
  let eventBus: FakeEventBus;
  let workflowClient: FakeWorkflowClient;
  let idempotencyStore: InMemoryIdempotencyStore;
  let service: MissionOrchestratorService;

  beforeEach(() => {
    missionRepository = new InMemoryMissionRepository();
    eventBus = new FakeEventBus();
    workflowClient = new FakeWorkflowClient();
    idempotencyStore = new InMemoryIdempotencyStore();
    service = new MissionOrchestratorService({
      missionRepository,
      eventBus,
      workflowClient,
      idempotencyStore,
      generateIdempotencyKey: createIdempotencyKeyGenerator(),
      generateEventId: createMissionIdGenerator(),
      generateCorrelationId: createCorrelationIdGenerator(),
    });
  });

  it('starts a mission and transitions to PLANNING', async () => {
    const mission = createTestMission({ status: 'APPROVED' });
    const ctx = createTenantContext('tenant-1', 'corr-1');
    await missionRepository.save(ctx, mission);
    const result = await service.startMission(ctx, { missionId: mission.id as string });

    expect(result.workflowId).toContain(mission.id);
    expect(workflowClient.started).toHaveLength(1);

    const updated = await missionRepository.findById(ctx, mission.id as string);
    expect(updated?.status).toBe('PLANNING');
    expect(eventBus.published.some((e) => e.eventType === 'MissionStarted')).toBe(true);
  });

  it('returns cached result for duplicate start mission command', async () => {
    const mission = createTestMission({ status: 'APPROVED' });
    const ctx = createTenantContext('tenant-1', 'corr-1');
    await missionRepository.save(ctx, mission);
    const result1 = await service.startMission(ctx, { missionId: mission.id as string });
    const result2 = await service.startMission(ctx, { missionId: mission.id as string });

    expect(result1.workflowId).toBe(result2.workflowId);
    expect(workflowClient.started).toHaveLength(1);
  });

  it('pauses a mission', async () => {
    const mission = createTestMission({ status: 'EXECUTING' });
    const ctx = createTenantContext('tenant-1', 'corr-1');
    await missionRepository.save(ctx, mission);
    await service.pauseMission(ctx, { missionId: mission.id as string, reason: 'Manual pause' });

    const updated = await missionRepository.findById(ctx, mission.id as string);
    expect(updated?.status).toBe('PAUSED');
    expect(workflowClient.signaled.some((s) => s.signalName === 'control' && (s.payload as { action: string }).action === 'PAUSE')).toBe(true);
  });

  it('is idempotent when pausing an already paused mission', async () => {
    const mission = createTestMission({ status: 'PAUSED' });
    const ctx = createTenantContext('tenant-1', 'corr-1');
    await missionRepository.save(ctx, mission);
    await service.pauseMission(ctx, { missionId: mission.id as string, reason: 'Manual pause' });

    expect(workflowClient.signaled.filter((s) => s.signalName === 'control').length).toBe(0);
  });

  it('resumes a paused mission', async () => {
    const mission = createTestMission({ status: 'PAUSED' });
    const ctx = createTenantContext('tenant-1', 'corr-1');
    await missionRepository.save(ctx, mission);
    await service.resumeMission(ctx, { missionId: mission.id as string });

    const updated = await missionRepository.findById(ctx, mission.id as string);
    expect(updated?.status).toBe('EXECUTING');
    expect(workflowClient.signaled.some((s) => s.signalName === 'control' && (s.payload as { action: string }).action === 'RESUME')).toBe(true);
  });

  it('is idempotent when resuming an already executing mission', async () => {
    const mission = createTestMission({ status: 'EXECUTING' });
    const ctx = createTenantContext('tenant-1', 'corr-1');
    await missionRepository.save(ctx, mission);
    await service.resumeMission(ctx, { missionId: mission.id as string });

    expect(workflowClient.signaled.filter((s) => s.signalName === 'control').length).toBe(0);
  });

  it('cancels a mission', async () => {
    const mission = createTestMission({ status: 'EXECUTING' });
    const ctx = createTenantContext('tenant-1', 'corr-1');
    await missionRepository.save(ctx, mission);
    await service.cancelMission(ctx, { missionId: mission.id as string, reason: 'Aborted' });

    const updated = await missionRepository.findById(ctx, mission.id as string);
    expect(updated?.status).toBe('CANCELLED');
    expect(workflowClient.signaled.some((s) => s.signalName === 'control' && (s.payload as { action: string }).action === 'CANCEL')).toBe(true);
    expect(workflowClient.cancelled).toHaveLength(0);
  });

  it('is idempotent when cancelling an already cancelled mission', async () => {
    const mission = createTestMission({ status: 'CANCELLED' });
    const ctx = createTenantContext('tenant-1', 'corr-1');
    await missionRepository.save(ctx, mission);
    await service.cancelMission(ctx, { missionId: mission.id as string, reason: 'Aborted' });

    expect(workflowClient.signaled.filter((s) => s.signalName === 'control').length).toBe(0);
  });

  it('rejects cross-tenant commands', async () => {
    const ctx1 = createTenantContext('tenant-1', 'corr-1');
    const mission = createTestMission({ tenantId: 'tenant-1', status: 'EXECUTING' });
    await missionRepository.save(ctx1, mission);

    const ctx = createTenantContext('tenant-2', 'corr-1');
    await expect(service.cancelMission(ctx, { missionId: mission.id as string, reason: 'x' })).rejects.toThrow();
  });

  it('signals a replan command', async () => {
    const mission = createTestMission({ status: 'EXECUTING' });
    const ctx = createTenantContext('tenant-1', 'corr-1');
    await missionRepository.save(ctx, mission);
    await service.replanMission(ctx, { missionId: mission.id as string });

    expect(workflowClient.signaled.some((s) => s.signalName === 'control' && (s.payload as { action: string }).action === 'REPLAN')).toBe(true);
  });
});
