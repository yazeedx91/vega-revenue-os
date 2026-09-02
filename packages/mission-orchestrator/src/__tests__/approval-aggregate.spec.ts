import { Approval } from '../domain/approval/approval';
import { asCorrelationId, asEventId, asIdempotencyKey, asTenantId, asUserId } from '@projectx/shared';

describe('Approval aggregate', () => {
  const tenantId = asTenantId('tenant-1');
  const correlationId = asCorrelationId('corr-1');

  function createApproval() {
    const result = Approval.create(
      {
        id: 'approval-1' as string,
        tenantId,
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
        correlationId,
      },
      asEventId('evt-1'),
    );

    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.value;
  }

  it('starts in PENDING', () => {
    const approval = createApproval();
    expect(approval.status).toBe('PENDING');
    expect(approval.domainEvents).toHaveLength(1);
    expect(approval.domainEvents[0].eventType).toBe('ApprovalRequested');
  });

  it('can be approved', () => {
    const approval = createApproval();
    approval.clearDomainEvents();
    const result = approval.approve(asUserId('user-1'), 'Looks good', asCorrelationId('corr-2'), asEventId('evt-2'));
    expect(result.success).toBe(true);
    expect(approval.status).toBe('APPROVED');
    expect(approval.decidedBy).toBe(asUserId('user-1'));
    expect(approval.decisionReason).toBe('Looks good');
    expect(approval.domainEvents[0].eventType).toBe('ApprovalStatusChanged');
  });

  it('can be rejected', () => {
    const approval = createApproval();
    const result = approval.reject(asUserId('user-1'), 'Too risky', asCorrelationId('corr-2'), asEventId('evt-2'));
    expect(result.success).toBe(true);
    expect(approval.status).toBe('REJECTED');
  });

  it('can expire and then escalate', () => {
    const approval = createApproval();
    approval.expire(asCorrelationId('corr-2'), asEventId('evt-2'));
    expect(approval.status).toBe('EXPIRED');

    const result = approval.escalate(asCorrelationId('corr-3'), asEventId('evt-3'));
    expect(result.success).toBe(false);
  });

  it('cannot approve twice', () => {
    const approval = createApproval();
    approval.approve(asUserId('user-1'), 'Looks good', asCorrelationId('corr-2'), asEventId('evt-2'));
    const result = approval.reject(asUserId('user-1'), 'Changed mind', asCorrelationId('corr-3'), asEventId('evt-3'));
    expect(result.success).toBe(false);
  });
});
