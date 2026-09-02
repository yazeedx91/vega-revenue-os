import { Actor } from '../actor/actor';
import { Mission, type MissionPlan } from '../mission/mission';
import { MissionTask } from '../mission/mission-task';
import {
  asCorrelationId,
  asEventId,
  asIdempotencyKey,
  asMissionId,
  asTaskId,
  asTenantId,
  asUserId,
} from '@projectx/shared';

function defaultPlan(): MissionPlan {
  return {
    planId: 'plan-1',
    version: 1,
    objectives: [],
    phases: [],
    approvalGates: [],
    fallbackBranches: [],
  };
}

function makeMission(tenantId = asTenantId('tenant-1')) {
  const result = Mission.create(
    {
      id: asMissionId('mission-1'),
      tenantId,
      name: 'Q3 Expansion',
      objective: 'Generate qualified opportunities in manufacturing',
      icpId: 'icp-1',
      territory: ['US', 'Canada'],
      channels: ['email'],
      budget: { maxAiCostUsd: 500 },
      autonomyLevel: 3,
      constraints: { workingHours: '9-17 EST' },
      successCriteria: { targetMeetings: 10 },
      deadline: new Date(Date.now() + 86_400_000),
      ownerUserId: asUserId('user-1'),
      plan: defaultPlan(),
    },
    asCorrelationId('corr-1'),
    asEventId('event-1'),
  );
  if (!result.success) {
    throw new Error(result.error.message);
  }
  return result.value;
}

function makeTaskProps(missionId: ReturnType<typeof asMissionId>, tenantId: ReturnType<typeof asTenantId>, id = 'task-1') {
  return {
    id: asTaskId(id),
    missionId,
    planId: 'plan-1',
    agentId: 'agent-1',
    agentVersion: '1.0.0',
    taskType: 'ResearchCompany',
    input: {},
    dependsOn: [] as ReturnType<typeof asTaskId>[],
    deadline: new Date(Date.now() + 86_400_000),
    idempotencyKey: asIdempotencyKey(`idem-${id}`),
    correlationId: asCorrelationId('corr-task'),
    actor: Actor.system('scheduler', tenantId),
  };
}

describe('Mission aggregate lifecycle', () => {
  it('creates a mission in DRAFT and emits MissionCreated', () => {
    const mission = makeMission();
    expect(mission.status).toBe('DRAFT');
    expect(mission.domainEvents[0]?.eventType).toBe('MissionCreated');
  });

  it('rejects creation with missing objective', () => {
    const result = Mission.create(
      {
        id: asMissionId('mission-1'),
        tenantId: asTenantId('tenant-1'),
        name: 'X',
        objective: '   ',
        icpId: 'icp-1',
        territory: [],
        channels: [],
        budget: { maxAiCostUsd: 1 },
        autonomyLevel: 1,
        constraints: {},
        successCriteria: {},
        ownerUserId: asUserId('user-1'),
        plan: defaultPlan(),
      },
      asCorrelationId('corr-1'),
      asEventId('event-1'),
    );
    expect(result.success).toBe(false);
  });

  it('executes approved lifecycle transitions', () => {
    const tenantId = asTenantId('tenant-1');
    const mission = makeMission(tenantId);
    const actor = Actor.human(asUserId('user-1'), tenantId);

    expect(mission.approve(actor, asCorrelationId('c2'), asEventId('e2')).success).toBe(true);
    expect(mission.status).toBe('APPROVED');
    expect(mission.start(asCorrelationId('c3'), asEventId('e3')).success).toBe(true);
    expect(mission.status).toBe('PLANNING');
  });

  it('blocks invalid state transitions', () => {
    const mission = makeMission();
    const result = mission.complete({ meetingsBooked: 1 }, asCorrelationId('c2'), asEventId('e2'));
    expect(result.success).toBe(false);
  });

  it('pauses, resumes, cancels, fails, archives', () => {
    const tenantId = asTenantId('tenant-1');
    const mission = makeMission(tenantId);
    const actor = Actor.human(asUserId('user-1'), tenantId);
    mission.approve(actor, asCorrelationId('c2'), asEventId('e2'));
    mission.start(asCorrelationId('c3'), asEventId('e3'));
    mission.planValid(asCorrelationId('c3b'), asEventId('e3b'));

    expect(mission.pause('budget review', asCorrelationId('c4'), asEventId('e4')).success).toBe(true);
    expect(mission.status).toBe('PAUSED');

    expect(mission.resume(asCorrelationId('c5'), asEventId('e5')).success).toBe(true);
    expect(mission.status).toBe('EXECUTING');

    expect(mission.cancel('no longer relevant', asCorrelationId('c6'), asEventId('e6')).success).toBe(true);
    expect(mission.status).toBe('CANCELLED');

    expect(mission.archive(asCorrelationId('c7'), asEventId('e7')).success).toBe(true);
    expect(mission.status).toBe('ARCHIVED');
  });

  it('completes with outcomes', () => {
    const tenantId = asTenantId('tenant-1');
    const mission = makeMission(tenantId);
    const actor = Actor.human(asUserId('user-1'), tenantId);
    mission.approve(actor, asCorrelationId('c2'), asEventId('e2'));
    mission.start(asCorrelationId('c3'), asEventId('e3'));
    mission.planValid(asCorrelationId('c3b'), asEventId('e3b'));

    const result = mission.complete({ meetingsBooked: 5, opportunitiesCreated: 2 }, asCorrelationId('c4'), asEventId('e4'));
    expect(result.success).toBe(true);
    expect(mission.status).toBe('COMPLETED');
    expect(mission.outcomes.meetingsBooked).toBe(5);
  });
});

describe('Mission task management', () => {
  it('adds tasks and rejects duplicate idempotency keys', () => {
    const tenantId = asTenantId('tenant-1');
    const mission = makeMission(tenantId);
    const props = makeTaskProps(mission.id, tenantId);

    const added = mission.addTask(props, asCorrelationId('c2'), asEventId('e2'));
    expect(added.success).toBe(true);
    expect(mission.tasks.length).toBe(1);

    const duplicate = mission.addTask(props, asCorrelationId('c3'), asEventId('e3'));
    expect(duplicate.success).toBe(false);
  });

  it('starts a task when dependencies are completed', () => {
    const tenantId = asTenantId('tenant-1');
    const mission = makeMission(tenantId);
    const actor = Actor.human(asUserId('user-1'), tenantId);
    mission.approve(actor, asCorrelationId('c2'), asEventId('e2'));
    mission.start(asCorrelationId('c3'), asEventId('e3'));
    mission.planValid(asCorrelationId('c3b'), asEventId('e3b'));

    const dep = makeTaskProps(mission.id, tenantId, 'dep');
    const task = makeTaskProps(mission.id, tenantId, 'task');
    task.dependsOn = [dep.id];

    mission.addTask(dep, asCorrelationId('c4'), asEventId('e4'));
    mission.addTask(task, asCorrelationId('c5'), asEventId('e5'));

    expect(mission.startTask(task.id, asCorrelationId('c6'), asEventId('e6')).success).toBe(false);

    mission.startTask(dep.id, asCorrelationId('c7'), asEventId('e7'));
    mission.completeTask(dep.id, { score: 0.9 }, asCorrelationId('c8'), asEventId('e8'));

    expect(mission.startTask(task.id, asCorrelationId('c9'), asEventId('e9')).success).toBe(true);
  });
});
