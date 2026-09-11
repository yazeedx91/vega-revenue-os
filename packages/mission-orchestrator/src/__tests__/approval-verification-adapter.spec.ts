import { asCorrelationId, asEventId, asIdempotencyKey, asTenantId } from '@projectx/shared';
import type { ApprovalId } from '@projectx/domain';
import { Approval, type ApprovalProps } from '../domain/approval/approval';
import { InMemoryApprovalRepository } from '../infrastructure/in-memory-approval-repository';
import { ApprovalVerificationAdapter } from '../infrastructure/approval-verification-adapter';

describe('ApprovalVerificationAdapter', () => {
  const tenantId = asTenantId('tenant-1');
  const ctx = { tenantId, workspaceId: 'workspace-1', correlationId: asCorrelationId('corr-1') };

  function makeApproval(overrides?: Partial<ApprovalProps>): Approval {
    const props: ApprovalProps = {
      id: 'approval-1' as unknown as ApprovalId,
      tenantId,
      workspaceId: 'workspace-1',
      workspaceBindingState: 'WORKSPACE_BOUND',
      missionId: 'mission-1',
      taskId: 'task-1',
      executionId: 'exec-1',
      actionType: 'OUTREACH_EMAIL_SEND',
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
      ...overrides,
    };
    const result = Approval.create(props, asEventId('evt-1'));
    if (!result.success) throw new Error(result.error.message);
    return result.value;
  }

  const baseRequest = {
    approvalId: 'approval-1',
    campaignId: 'camp-1' as any,
    sequenceId: 'seq-1' as any,
    executionId: 'exec-1' as any,
    idempotencyKey: asIdempotencyKey('idem-1'),
    recipientAddress: 'a@b.com',
    actionType: 'OUTREACH_EMAIL_SEND',
    correlationId: asCorrelationId('corr-2'),
  };

  it('returns APPROVED for a valid, current-tenant, target-matched, unexpired approval', async () => {
    const repo = new InMemoryApprovalRepository();
    const approval = makeApproval();
    approval.approve('user-1' as any, 'looks good', asCorrelationId('c2'), asEventId('e2'));
    await repo.save(ctx, approval);

    const adapter = new ApprovalVerificationAdapter(repo);
    const result = await adapter.verify(ctx, baseRequest);

    expect(result.outcome).toBe('APPROVED');
  });

  it('returns NOT_FOUND when no approval exists for the given id', async () => {
    const repo = new InMemoryApprovalRepository();
    const adapter = new ApprovalVerificationAdapter(repo);

    const result = await adapter.verify(ctx, baseRequest);

    expect(result.outcome).toBe('NOT_FOUND');
  });

  it('returns NOT_FOUND when the approval belongs to a different tenant (repository load is tenant-scoped)', async () => {
    const repo = new InMemoryApprovalRepository();
    const approval = makeApproval({ tenantId: asTenantId('tenant-other') });
    approval.approve('user-1' as any, 'ok', asCorrelationId('c2'), asEventId('e2'));
    await repo.save({ ...ctx, tenantId: asTenantId('tenant-other') }, approval);

    const adapter = new ApprovalVerificationAdapter(repo);
    const result = await adapter.verify(ctx, baseRequest);

    // The underlying IApprovalRepository.load(tenantId, id) is itself
    // tenant-scoped, so a cross-tenant approval is indistinguishable from a
    // missing one at this layer — both correctly result in denial.
    expect(result.outcome).toBe('NOT_FOUND');
  });

  it('returns WRONG_TARGET when the approval targets a different execution', async () => {
    const repo = new InMemoryApprovalRepository();
    const approval = makeApproval({ executionId: 'a-different-execution' });
    approval.approve('user-1' as any, 'ok', asCorrelationId('c2'), asEventId('e2'));
    await repo.save(ctx, approval);

    const adapter = new ApprovalVerificationAdapter(repo);
    const result = await adapter.verify(ctx, baseRequest);

    expect(result.outcome).toBe('WRONG_TARGET');
  });

  it('returns INVALID_ACTION_TYPE when the approval was requested for a different action', async () => {
    const repo = new InMemoryApprovalRepository();
    const approval = makeApproval({ actionType: 'OUTREACH_LINKEDIN_SEND' });
    approval.approve('user-1' as any, 'ok', asCorrelationId('c2'), asEventId('e2'));
    await repo.save(ctx, approval);

    const adapter = new ApprovalVerificationAdapter(repo);
    const result = await adapter.verify(ctx, baseRequest);

    expect(result.outcome).toBe('INVALID_ACTION_TYPE');
  });

  it('returns REJECTED when the approval was rejected', async () => {
    const repo = new InMemoryApprovalRepository();
    const approval = makeApproval();
    approval.reject('user-1' as any, 'no', asCorrelationId('c2'), asEventId('e2'));
    await repo.save(ctx, approval);

    const adapter = new ApprovalVerificationAdapter(repo);
    const result = await adapter.verify(ctx, baseRequest);

    expect(result.outcome).toBe('REJECTED');
  });

  it('returns PENDING when the approval has not yet been decided', async () => {
    const repo = new InMemoryApprovalRepository();
    const approval = makeApproval();
    await repo.save(ctx, approval);

    const adapter = new ApprovalVerificationAdapter(repo);
    const result = await adapter.verify(ctx, baseRequest);

    expect(result.outcome).toBe('PENDING');
  });

  it('returns PENDING when the approval has been escalated but not yet decided', async () => {
    const repo = new InMemoryApprovalRepository();
    const approval = makeApproval();
    approval.escalate(asCorrelationId('c2'), asEventId('e2'));
    await repo.save(ctx, approval);

    const adapter = new ApprovalVerificationAdapter(repo);
    const result = await adapter.verify(ctx, baseRequest);

    expect(result.outcome).toBe('PENDING');
  });

  it('returns EXPIRED when the approval was explicitly expired', async () => {
    const repo = new InMemoryApprovalRepository();
    const approval = makeApproval();
    approval.expire(asCorrelationId('c2'), asEventId('e2'));
    await repo.save(ctx, approval);

    const adapter = new ApprovalVerificationAdapter(repo);
    const result = await adapter.verify(ctx, baseRequest);

    expect(result.outcome).toBe('EXPIRED');
  });

  it('returns EXPIRED when the approval is APPROVED but has exceeded its timeout window', async () => {
    const repo = new InMemoryApprovalRepository();
    const approval = makeApproval({ timeoutSeconds: 1, createdAt: new Date(Date.now() - 10_000) });
    approval.approve('user-1' as any, 'ok', asCorrelationId('c2'), asEventId('e2'));
    await repo.save(ctx, approval);

    const adapter = new ApprovalVerificationAdapter(repo);
    const result = await adapter.verify(ctx, baseRequest);

    expect(result.outcome).toBe('EXPIRED');
  });
});
