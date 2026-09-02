import type { Pool } from 'pg';
import { Actor, Mission } from '@projectx/domain';
import { FakePgPool } from '@projectx/infrastructure';
import { asCorrelationId, asEventId, asMissionId, asTenantId, asUserId } from '@projectx/shared';
import { PostgresMissionRepository } from '../infrastructure/postgres-mission-repository';

describe('PostgresMissionRepository', () => {
  const tenantId = asTenantId('tenant-1');

  function makeMission() {
    const result = Mission.create(
      {
        id: asMissionId('mission-1'),
        tenantId,
        name: 'Research Mission',
        objective: 'find qualified prospects',
        icpId: 'icp-1',
        territory: ['US'],
        channels: ['email'],
        budget: { maxAiCostUsd: 100 },
        autonomyLevel: 0.5,
        constraints: {},
        successCriteria: { targetMeetings: 1 },
        deadline: new Date(Date.now() + 86_400_000),
        ownerUserId: asUserId('owner-1'),
        plan: { planId: 'p-1', version: 1, objectives: [], phases: [], approvalGates: [], fallbackBranches: [] },
      },
      asCorrelationId('corr-1'),
      asEventId('evt-1'),
    );
    if (!result.success) throw new Error(result.error.message);
    return result.value;
  }

  function makeRepo() {
    return new PostgresMissionRepository({ pool: new FakePgPool() as unknown as Pool });
  }

  it('preserves status, deadline, and budget across save/reload', async () => {
    const repo = makeRepo();
    const mission = makeMission();
    const actor = Actor.human(asUserId('owner-1'), tenantId);
    mission.approve(actor, asCorrelationId('c2'), asEventId('e2'));
    mission.start(asCorrelationId('c3'), asEventId('e3'));
    mission.planValid(asCorrelationId('c4'), asEventId('e4'));

    await repo.save(mission);
    const reloaded = await repo.load(tenantId, 'mission-1');

    expect(reloaded).not.toBeNull();
    expect(reloaded!.status).toBe('EXECUTING');
    expect(reloaded!.budget.maxAiCostUsd).toBe(100);
    expect(reloaded!.deadline).toBeInstanceOf(Date);
    expect(reloaded!.createdAt).toBeInstanceOf(Date);
  });

  it('preserves approvals array (previously inaccessible — Mission had no public getter) across save/reload', async () => {
    const repo = makeRepo();
    const mission = makeMission();
    await repo.save(mission);

    const reloaded = await repo.load(tenantId, 'mission-1');
    expect(reloaded!.approvals).toEqual([]);
  });

  it('rejects a stale-version save as a concurrency conflict', async () => {
    const repo = makeRepo();
    const mission = makeMission();
    await repo.save(mission);

    const actor = Actor.human(asUserId('owner-1'), tenantId);
    const loaderA = await repo.load(tenantId, 'mission-1');
    const loaderB = await repo.load(tenantId, 'mission-1');

    loaderA!.approve(actor, asCorrelationId('c2'), asEventId('e2'));
    await repo.save(loaderA!);

    loaderB!.cancel('duplicate', asCorrelationId('c3'), asEventId('e3'));
    await expect(repo.save(loaderB!)).rejects.toThrow();
  });
});
