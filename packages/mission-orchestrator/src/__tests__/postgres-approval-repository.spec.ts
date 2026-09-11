import type { Pool } from 'pg';
import { FakePgPool } from '@projectx/infrastructure';
import { asCorrelationId, asEventId, asIdempotencyKey, asTenantId, asUserId } from '@projectx/shared';
import { Approval } from '../domain/approval/approval';
import { PostgresApprovalRepository } from '../infrastructure/postgres-approval-repository';

describe('PostgresApprovalRepository', () => {
  const tenantId = asTenantId('tenant-1');

  function makeApproval() {
    const result = Approval.create(
      {
        id: 'approval-1' as string,
        tenantId,
        workspaceId: 'workspace-1',
        workspaceBindingState: 'WORKSPACE_BOUND',
        missionId: 'mission-1',
        taskId: 'task-1',
        executionId: 'exec-1',
        actionType: 'send-message',
        riskCategory: 'HIGH',
        proposedAction: { message: 'hello' },
        evidence: [],
        reasoning: 'Confidence is high',
        confidence: 0.95,
        requestedBy: 'agent-1',
        approverRole: 'mission-owner',
        timeoutSeconds: 3600,
        idempotencyKey: asIdempotencyKey('idem-1'),
        correlationId: asCorrelationId('corr-1'),
      },
      asEventId('evt-1'),
    );
    if (!result.success) throw new Error(result.error.message);
    return result.value;
  }

  const ctx = { tenantId, workspaceId: 'workspace-1', correlationId: asCorrelationId('corr-1') };

  function makeRepo() {
    return new PostgresApprovalRepository({ pool: new FakePgPool() as unknown as Pool });
  }

  it('preserves correlationId, decidedBy, and dates across save/reload (correlationId was previously unrecoverable)', async () => {
    const repo = makeRepo();
    const approval = makeApproval();
    approval.approve(asUserId('user-1'), 'Looks good', asCorrelationId('corr-2'), asEventId('evt-2'));

    await repo.save(ctx, approval);
    const reloaded = await repo.load(ctx, approval.id as string);

    expect(reloaded).not.toBeNull();
    expect(reloaded!.status).toBe('APPROVED');
    expect(reloaded!.decidedBy).toBe(asUserId('user-1'));
    expect(reloaded!.decisionReason).toBe('Looks good');
    expect(reloaded!.correlationId).toBe(asCorrelationId('corr-1'));
    expect(reloaded!.createdAt).toBeInstanceOf(Date);
    expect(reloaded!.updatedAt).toBeInstanceOf(Date);
  });

  it('rejects a stale-version save as a concurrency conflict', async () => {
    const repo = makeRepo();
    const approval = makeApproval();
    await repo.save(ctx, approval);

    const loaderA = await repo.load(ctx, approval.id as string);
    const loaderB = await repo.load(ctx, approval.id as string);

    loaderA!.approve(asUserId('user-1'), 'ok', asCorrelationId('c2'), asEventId('e2'));
    await repo.save(ctx, loaderA!);

    loaderB!.reject(asUserId('user-2'), 'no', asCorrelationId('c3'), asEventId('e3'));
    await expect(repo.save(ctx, loaderB!)).rejects.toThrow();
  });
});
