import { OutreachMessageExecution } from '@projectx/domain';
import { asCampaignId, asCorrelationId, asEventId, asIdempotencyKey, asOutreachExecutionId, asSequenceId, asTenantId } from '@projectx/shared';

describe('OutreachMessageExecution lifecycle transitions', () => {
  const tenantId = asTenantId('tenant-a');
  const correlationId = asCorrelationId('corr-1');
  const eventId = asEventId('evt-1');

  function createExecution() {
    return OutreachMessageExecution.create(
      {
        tenantId,
        campaignId: asCampaignId('camp-1'),
        sequenceId: asSequenceId('seq-1'),
        stepNumber: 1,
        leadId: 'lead-1',
        recipientAddress: 'prospect@example.com',
        channel: 'email',
        idempotencyKey: asIdempotencyKey('idmp-1'),
      },
      correlationId,
      eventId,
    );
  }

  it('supports the full happy path through delivery', () => {
    const execution = createExecution();

    expect(execution.status).toBe('PENDING');

    execution.startDrafting(correlationId, eventId);
    expect(execution.status).toBe('DRAFTING');

    execution.setDraft(
      'msg-1' as any,
      { subject: 'Hello', body: '<p>Hi</p>', cta: 'Reply' },
      correlationId,
      eventId,
    );
    expect(execution.status).toBe('PENDING_APPROVAL');

    execution.approve('approval-1' as any, correlationId, eventId);
    expect(execution.status).toBe('APPROVED');

    execution.markSending(correlationId, eventId);
    expect(execution.status).toBe('SENDING');

    execution.markProviderAttempt('graph-email');
    expect(execution.status).toBe('SENDING');
    expect(execution.providerId).toBe('graph-email');

    execution.markProviderAccepted(undefined, undefined, undefined, correlationId, eventId);
    expect(execution.status).toBe('PROVIDER_ACCEPTED');

    execution.markDeliveryPending(correlationId, eventId);
    expect(execution.status).toBe('DELIVERY_PENDING');

    execution.markDelivered(undefined, correlationId, eventId);
    expect(execution.status).toBe('DELIVERED');

    execution.markOpened(correlationId, eventId);
    expect(execution.status).toBe('OPENED');

    execution.markReplied(correlationId, eventId);
    expect(execution.status).toBe('REPLIED');
  });

  it('records a pre-submission failure from SENDING', () => {
    const execution = createExecution();
    execution.startDrafting(correlationId, eventId);
    execution.setDraft('msg-1' as any, { subject: 'x', body: 'y' }, correlationId, eventId);
    execution.approve('approval-1' as any, correlationId, eventId);
    execution.markSending(correlationId, eventId);

    execution.markFailed('NON_RETRYABLE', 'No provider', 'NO_PROVIDER', correlationId, eventId);
    expect(execution.status).toBe('FAILED_PRE_SUBMISSION');
    expect(execution.failedAt).toBeInstanceOf(Date);
  });

  it('records a delivery failure from DELIVERY_PENDING', () => {
    const execution = createExecution();
    execution.startDrafting(correlationId, eventId);
    execution.setDraft('msg-1' as any, { subject: 'x', body: 'y' }, correlationId, eventId);
    execution.approve('approval-1' as any, correlationId, eventId);
    execution.markSending(correlationId, eventId);
    execution.markProviderAccepted('pm-1', 'im-1', undefined, correlationId, eventId);
    execution.markDeliveryPending(correlationId, eventId);

    execution.markFailed('NON_RETRYABLE', 'Bounced', 'BOUNCED', correlationId, eventId);
    expect(execution.status).toBe('DELIVERY_FAILED');
    expect(execution.deliveryFailedAt).toBeInstanceOf(Date);
    expect(execution.failedAt).toBeInstanceOf(Date);
  });

  it('records a post-acceptance retryable failure as REQUIRES_RECONCILIATION', () => {
    const execution = createExecution();
    execution.startDrafting(correlationId, eventId);
    execution.setDraft('msg-1' as any, { subject: 'x', body: 'y' }, correlationId, eventId);
    execution.approve('approval-1' as any, correlationId, eventId);
    execution.markSending(correlationId, eventId);
    execution.markProviderAccepted('pm-1', 'im-1', undefined, correlationId, eventId);
    execution.markDeliveryPending(correlationId, eventId);

    execution.markFailed('RETRYABLE', 'Provider timeout', 'TIMEOUT', correlationId, eventId);
    expect(execution.status).toBe('REQUIRES_RECONCILIATION');
  });

  it('records DELIVERY_UNKNOWN when an outcome is ambiguous', () => {
    const execution = createExecution();
    execution.startDrafting(correlationId, eventId);
    execution.setDraft('msg-1' as any, { subject: 'x', body: 'y' }, correlationId, eventId);
    execution.approve('approval-1' as any, correlationId, eventId);
    execution.markSending(correlationId, eventId);

    execution.markDeliveryUnknown('Response lost', correlationId, eventId);
    expect(execution.status).toBe('DELIVERY_UNKNOWN');
  });

  it('rejects invalid transitions from terminal states', () => {
    const terminalStates: { state: string; setup: (e: OutreachMessageExecution) => void }[] = [
      {
        state: 'DELIVERED',
        setup: (e) => {
          e.startDrafting(correlationId, eventId);
          e.setDraft('msg-1' as any, { subject: 'x', body: 'y' }, correlationId, eventId);
          e.approve('approval-1' as any, correlationId, eventId);
          e.markSending(correlationId, eventId);
          e.markProviderAccepted(undefined, undefined, undefined, correlationId, eventId);
          e.markDeliveryPending(correlationId, eventId);
          e.markDelivered(undefined, correlationId, eventId);
        },
      },
      {
        state: 'REPLIED',
        setup: (e) => {
          e.startDrafting(correlationId, eventId);
          e.setDraft('msg-1' as any, { subject: 'x', body: 'y' }, correlationId, eventId);
          e.approve('approval-1' as any, correlationId, eventId);
          e.markSending(correlationId, eventId);
          e.markProviderAccepted(undefined, undefined, undefined, correlationId, eventId);
          e.markDeliveryPending(correlationId, eventId);
          e.markDelivered(undefined, correlationId, eventId);
          e.markOpened(correlationId, eventId);
          e.markReplied(correlationId, eventId);
        },
      },
      {
        state: 'FAILED_PRE_SUBMISSION',
        setup: (e) => {
          e.startDrafting(correlationId, eventId);
          e.setDraft('msg-1' as any, { subject: 'x', body: 'y' }, correlationId, eventId);
          e.approve('approval-1' as any, correlationId, eventId);
          e.markSending(correlationId, eventId);
          e.markFailed('NON_RETRYABLE', 'No provider', 'NO_PROVIDER', correlationId, eventId);
        },
      },
      {
        state: 'DELIVERY_FAILED',
        setup: (e) => {
          e.startDrafting(correlationId, eventId);
          e.setDraft('msg-1' as any, { subject: 'x', body: 'y' }, correlationId, eventId);
          e.approve('approval-1' as any, correlationId, eventId);
          e.markSending(correlationId, eventId);
          e.markProviderAccepted(undefined, undefined, undefined, correlationId, eventId);
          e.markDeliveryPending(correlationId, eventId);
          e.markFailed('NON_RETRYABLE', 'Bounced', 'BOUNCED', correlationId, eventId);
        },
      },
      {
        state: 'DELIVERY_UNKNOWN',
        setup: (e) => {
          e.startDrafting(correlationId, eventId);
          e.setDraft('msg-1' as any, { subject: 'x', body: 'y' }, correlationId, eventId);
          e.approve('approval-1' as any, correlationId, eventId);
          e.markSending(correlationId, eventId);
          e.markDeliveryUnknown('Response lost', correlationId, eventId);
        },
      },
      {
        state: 'REQUIRES_RECONCILIATION',
        setup: (e) => {
          e.startDrafting(correlationId, eventId);
          e.setDraft('msg-1' as any, { subject: 'x', body: 'y' }, correlationId, eventId);
          e.approve('approval-1' as any, correlationId, eventId);
          e.markSending(correlationId, eventId);
          e.markProviderAccepted(undefined, undefined, undefined, correlationId, eventId);
          e.markDeliveryPending(correlationId, eventId);
          e.markFailed('RETRYABLE', 'Timeout', 'TIMEOUT', correlationId, eventId);
        },
      },
      {
        state: 'FAILED',
        setup: (e) => {
          e.startDrafting(correlationId, eventId);
          e.setDraft('msg-1' as any, { subject: 'x', body: 'y' }, correlationId, eventId);
          e.reject('Approval rejected', correlationId, eventId);
        },
      },
    ];

    for (const { state, setup } of terminalStates) {
      const execution = createExecution();
      setup(execution);
      expect(execution.status).toBe(state);
      expect(execution.markSending(correlationId, eventId).success).toBe(false);
      expect(execution.approve('approval-2' as any, correlationId, eventId).success).toBe(false);
      expect(execution.markDelivered(undefined, correlationId, eventId).success).toBe(false);
    }
  });

  it('rejects invalid transitions from intermediate states', () => {
    const execution = createExecution();
    execution.startDrafting(correlationId, eventId);
    expect(execution.markSending(correlationId, eventId).success).toBe(false);
    expect(execution.markDelivered(undefined, correlationId, eventId).success).toBe(false);

    execution.setDraft('msg-1' as any, { subject: 'x', body: 'y' }, correlationId, eventId);
    expect(execution.markSending(correlationId, eventId).success).toBe(false);

    execution.approve('approval-1' as any, correlationId, eventId);
    expect(execution.markDelivered(undefined, correlationId, eventId).success).toBe(false);
  });

  it('records the provider-specific accepted timestamp and error code', () => {
    const execution = createExecution();
    execution.startDrafting(correlationId, eventId);
    execution.setDraft('msg-1' as any, { subject: 'x', body: 'y' }, correlationId, eventId);
    execution.approve('approval-1' as any, correlationId, eventId);
    execution.markSending(correlationId, eventId);

    execution.markProviderAccepted('pm-1', 'im-1', 'ACCEPTED_202', correlationId, eventId);
    expect(execution.providerMessageId).toBe('pm-1');
    expect(execution.internetMessageId).toBe('im-1');
    expect(execution.providerErrorCode).toBe('ACCEPTED_202');
    expect(execution.providerAcceptedAt).toBeInstanceOf(Date);
  });
});
