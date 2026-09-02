import { Actor } from '@projectx/domain';
import {
  asCorrelationId,
  asIdempotencyKey,
  asMissionId,
  asTenantId,
  asUserId,
} from '@projectx/shared';
import { CommandExecutor } from '../commands/command-executor';
import type { CommandContext } from '../commands/command-context';
import {
  ApproveMissionHandler,
  CreateMissionHandler,
  StartMissionHandler,
} from '../handlers/mission';
import { InMemoryMissionRepository } from '../persistence/in-memory-mission.repository';
import { InMemoryAuditLog } from '../test-doubles/audit-log';
import { CollectingEventPublisher } from '../test-doubles/event-publisher';
import { InMemoryIdempotencyStore } from '../test-doubles/idempotency-store';
import { FixedPolicyService } from '../test-doubles/policy-service';
import { NoOpTelemetry } from '../test-doubles/telemetry';

function defaultPlan() {
  return {
    planId: 'plan-1',
    version: 1,
    objectives: [],
    phases: [],
    approvalGates: [],
    fallbackBranches: [],
  };
}

function makeCreateCommand(id: string) {
  return {
    id,
    name: 'Q3 Expansion',
    objective: 'Generate qualified opportunities',
    icpId: 'icp-1',
    territory: ['US'],
    channels: ['email'],
    budget: { maxAiCostUsd: 500 },
    autonomyLevel: 3,
    constraints: {},
    successCriteria: {},
    deadline: new Date(Date.now() + 86_400_000),
    ownerUserId: asUserId('user-1'),
    plan: defaultPlan(),
  };
}

describe('Mission command pipeline', () => {
  const tenantId = asTenantId('tenant-1');
  const actor = Actor.human(asUserId('user-1'), tenantId);
  const ctx: CommandContext = {
    tenantId,
    actor,
    correlationId: asCorrelationId('corr-1'),
    idempotencyKey: asIdempotencyKey('idem-create'),
  };

  function makeExecutor() {
    return new CommandExecutor({
      telemetry: new NoOpTelemetry(),
      auditLog: new InMemoryAuditLog(),
      idempotencyStore: new InMemoryIdempotencyStore(),
      eventPublisher: new CollectingEventPublisher(),
    });
  }

  it('creates a mission through the pipeline', async () => {
    const repo = new InMemoryMissionRepository();
    const executor = makeExecutor();

    const result = await executor.execute(
      ctx,
      makeCreateCommand('mission-1'),
      new CreateMissionHandler(repo),
      { idempotent: true, auditAction: 'mission.create' },
    );

    expect(result.success).toBe(true);
    const stored = await repo.findById(ctx, asMissionId('mission-1'));
    expect(stored).not.toBeNull();
    expect(stored?.status).toBe('DRAFT');
  });

  it('enforces tenant isolation in repositories', async () => {
    const repo = new InMemoryMissionRepository();
    const executor = makeExecutor();
    await executor.execute(ctx, makeCreateCommand('mission-1'), new CreateMissionHandler(repo), {
      idempotent: true,
    });

    const otherTenant = asTenantId('tenant-2');
    const otherCtx: CommandContext = {
      tenantId: otherTenant,
      actor: Actor.human(asUserId('user-2'), otherTenant),
      correlationId: asCorrelationId('corr-2'),
    };
    const loaded = await repo.findById(otherCtx, asMissionId('mission-1'));
    expect(loaded).toBeNull();
  });

  it('approves and starts a mission when policy allows', async () => {
    const repo = new InMemoryMissionRepository();
    const executor = makeExecutor();
    await executor.execute(ctx, makeCreateCommand('mission-2'), new CreateMissionHandler(repo), {
      idempotent: true,
    });

    const approveResult = await executor.execute(
      ctx,
      { missionId: 'mission-2' },
      new ApproveMissionHandler(repo, new FixedPolicyService('ALLOW')),
      { idempotent: true, auditAction: 'mission.approve' },
    );
    expect(approveResult.success).toBe(true);

    const startResult = await executor.execute(
      ctx,
      { missionId: 'mission-2' },
      new StartMissionHandler(repo, new FixedPolicyService('ALLOW')),
      { idempotent: true, auditAction: 'mission.start' },
    );
    expect(startResult.success).toBe(true);

    const mission = await repo.findById(ctx, asMissionId('mission-2'));
    expect(mission?.status).toBe('PLANNING');
  });

  it('blocks approval when policy denies', async () => {
    const repo = new InMemoryMissionRepository();
    const executor = makeExecutor();
    await executor.execute(ctx, makeCreateCommand('mission-3'), new CreateMissionHandler(repo), {
      idempotent: true,
    });

    const approveResult = await executor.execute(
      ctx,
      { missionId: 'mission-3' },
      new ApproveMissionHandler(repo, new FixedPolicyService('DENY')),
      { idempotent: true, auditAction: 'mission.approve' },
    );
    expect(approveResult.success).toBe(false);
  });
});
