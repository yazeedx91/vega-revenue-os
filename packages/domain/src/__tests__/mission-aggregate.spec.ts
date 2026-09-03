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

function makeTaskProps(
  missionId: ReturnType<typeof asMissionId>,
  tenantId: ReturnType<typeof asTenantId>,
  id = 'task-1',
  requiredCapability?: string,
) {
  return {
    id: asTaskId(id),
    missionId,
    planId: 'plan-1',
    agentId: 'agent-1',
    agentVersion: '1.0.0',
    taskType: 'ResearchCompany',
    requiredCapability,
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

describe('Mission plan validation and replanning', () => {
  function makeReplanPlan(missionId: string, version: number, overrides: Partial<MissionPlan> = {}): MissionPlan {
    return {
      planId: `${missionId}-plan-${version}`,
      version,
      objectives: [],
      phases: [],
      approvalGates: [],
      fallbackBranches: [],
      ...overrides,
    };
  }

  it('rejects plan validation when task IDs are duplicated', () => {
    const tenantId = asTenantId('tenant-1');
    const mission = makeMission(tenantId);
    const actor = Actor.human(asUserId('user-1'), tenantId);
    mission.approve(actor, asCorrelationId('c2'), asEventId('e2'));
    mission.start(asCorrelationId('c3'), asEventId('e3'));

    const t1 = makeTaskProps(mission.id, tenantId, 'task-1');
    const t2 = makeTaskProps(mission.id, tenantId, 'task-1');
    mission.addTask(t1, asCorrelationId('c4'), asEventId('e4'));
    const result = mission.addTask(t2, asCorrelationId('c5'), asEventId('e5'));

    expect(result.success).toBe(false);
  });

  it('rejects plan validation when dependencies are missing', () => {
    const tenantId = asTenantId('tenant-1');
    const mission = makeMission(tenantId);
    const actor = Actor.human(asUserId('user-1'), tenantId);
    mission.approve(actor, asCorrelationId('c2'), asEventId('e2'));
    mission.start(asCorrelationId('c3'), asEventId('e3'));

    const task = makeTaskProps(mission.id, tenantId, 'task-1');
    task.dependsOn = [asTaskId('missing-dep')];
    mission.addTask(task, asCorrelationId('c4'), asEventId('e4'));

    const result = mission.planValid(asCorrelationId('c5'), asEventId('e5'));
    expect(result.success).toBe(false);
  });

  it('rejects plan validation when dependencies form a cycle', () => {
    const tenantId = asTenantId('tenant-1');
    const mission = makeMission(tenantId);
    const actor = Actor.human(asUserId('user-1'), tenantId);
    mission.approve(actor, asCorrelationId('c2'), asEventId('e2'));
    mission.start(asCorrelationId('c3'), asEventId('e3'));

    const t1 = makeTaskProps(mission.id, tenantId, 'task-1');
    const t2 = makeTaskProps(mission.id, tenantId, 'task-2');
    t1.dependsOn = [t2.id];
    t2.dependsOn = [t1.id];

    mission.addTask(t1, asCorrelationId('c4'), asEventId('e4'));
    mission.addTask(t2, asCorrelationId('c5'), asEventId('e5'));

    const result = mission.planValid(asCorrelationId('c6'), asEventId('e6'));
    expect(result.success).toBe(false);
  });

  it('rejects an empty required capability', () => {
    const tenantId = asTenantId('tenant-1');
    const mission = makeMission(tenantId);
    const actor = Actor.human(asUserId('user-1'), tenantId);
    mission.approve(actor, asCorrelationId('c2'), asEventId('e2'));
    mission.start(asCorrelationId('c3'), asEventId('e3'));

    const task = makeTaskProps(mission.id, tenantId, 'task-1', '   ');
    const result = mission.addTask(task, asCorrelationId('c4'), asEventId('e4'));
    expect(result.success).toBe(false);
  });

  it('rejects a plan with non-positive version', () => {
    const tenantId = asTenantId('tenant-1');
    const mission = makeMission(tenantId);
    const actor = Actor.human(asUserId('user-1'), tenantId);
    mission.approve(actor, asCorrelationId('c2'), asEventId('e2'));
    mission.start(asCorrelationId('c3'), asEventId('e3'));

    mission.plan = makeReplanPlan(mission.id as string, 0);
    const result = mission.planValid(asCorrelationId('c4'), asEventId('e4'));
    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/version/);
  });

  it('replan rejects versions that are not greater than the current plan', () => {
    const tenantId = asTenantId('tenant-1');
    const mission = makeMission(tenantId);
    const actor = Actor.human(asUserId('user-1'), tenantId);
    mission.approve(actor, asCorrelationId('c2'), asEventId('e2'));
    mission.start(asCorrelationId('c3'), asEventId('e3'));

    const task = makeTaskProps(mission.id, tenantId, 'task-1');
    const result = mission.replan(
      makeReplanPlan(mission.id as string, 0),
      [task],
      asCorrelationId('c4'),
      asEventId('e4'),
    );
    expect(result.success).toBe(false);
  });

  it('replan preserves completed task outputs and increases plan version', () => {
    const tenantId = asTenantId('tenant-1');
    const mission = makeMission(tenantId);
    const actor = Actor.human(asUserId('user-1'), tenantId);
    mission.approve(actor, asCorrelationId('c2'), asEventId('e2'));
    mission.start(asCorrelationId('c3'), asEventId('e3'));

    const t1 = makeTaskProps(mission.id, tenantId, 'task-1');
    mission.addTask(t1, asCorrelationId('c4'), asEventId('e4'));
    mission.planValid(asCorrelationId('c5'), asEventId('e5'));

    mission.startTask(t1.id, asCorrelationId('c6'), asEventId('e6'));
    mission.completeTask(t1.id, { score: 0.9 }, asCorrelationId('c7'), asEventId('e7'));

    const replanResult = mission.replan(
      makeReplanPlan(mission.id as string, 2),
      [makeTaskProps(mission.id, tenantId, 'task-1'), makeTaskProps(mission.id, tenantId, 'task-2')],
      asCorrelationId('c8'),
      asEventId('e8'),
    );
    expect(replanResult.success).toBe(true);
    expect(mission.plan.version).toBe(2);

    const preserved = mission.tasks.find((t) => t.id === t1.id);
    expect(preserved?.status).toBe('COMPLETED');
    expect(preserved?.output).toEqual({ score: 0.9 });
    expect(mission.domainEvents.some((e) => e.eventType === 'MissionReplanned')).toBe(true);
  });

  it('replan rejects cyclic new plans', () => {
    const tenantId = asTenantId('tenant-1');
    const mission = makeMission(tenantId);
    const actor = Actor.human(asUserId('user-1'), tenantId);
    mission.approve(actor, asCorrelationId('c2'), asEventId('e2'));
    mission.start(asCorrelationId('c3'), asEventId('e3'));

    const t1 = makeTaskProps(mission.id, tenantId, 'task-1');
    const t2 = makeTaskProps(mission.id, tenantId, 'task-2');
    t1.dependsOn = [t2.id];
    t2.dependsOn = [t1.id];

    const result = mission.replan(
      makeReplanPlan(mission.id as string, 2),
      [t1, t2],
      asCorrelationId('c4'),
      asEventId('e4'),
    );
    expect(result.success).toBe(false);
  });
});
