import type { Pool } from 'pg';
import { OutreachMessageExecution } from '@projectx/domain';
import { FakePgPool } from '@projectx/infrastructure';
import {
  asCampaignId,
  asCorrelationId,
  asEventId,
  asIdempotencyKey,
  asOutreachExecutionId,
  asSequenceId,
  asTenantId,
} from '@projectx/shared';
import { PostgresMessageExecutionRepository } from '../infrastructure/postgres-message-execution-repository';

describe('PostgresMessageExecutionRepository', () => {
  const tenantId = asTenantId('tenant-1');
  const ctx = { tenantId, correlationId: asCorrelationId('corr-1') };

  function makeExecution() {
    return OutreachMessageExecution.create(
      {
        id: asOutreachExecutionId('exec-1'),
        tenantId,
        campaignId: asCampaignId('camp-1'),
        sequenceId: asSequenceId('seq-1'),
        stepNumber: 1,
        leadId: 'lead-1',
        recipientAddress: 'a@b.com',
        channel: 'email',
        idempotencyKey: asIdempotencyKey('idem-1'),
      },
      asCorrelationId('corr-1'),
      asEventId('evt-1'),
    );
  }

  function makeRepo() {
    return new PostgresMessageExecutionRepository({ pool: new FakePgPool() as unknown as Pool });
  }

  it('preserves status, attempts, and dates across save/reload', async () => {
    const repo = makeRepo();
    const execution = makeExecution();
    execution.startDrafting(asCorrelationId('c2'), asEventId('e2'));
    execution.setDraft(
      'msg-1' as any,
      { body: 'hello', tone: 'professional', claims: [], evidenceReferences: [], unsupportedClaimsRemoved: [] },
      asCorrelationId('c3'),
      asEventId('e3'),
    );
    execution.approve('approval-1' as any, asCorrelationId('c4'), asEventId('e4'));
    execution.markSending(asCorrelationId('c5'), asEventId('e5'));
    execution.markProviderAttempt('stub-email');

    await repo.save(ctx, execution);
    const reloaded = await repo.load(ctx, execution.id);

    expect(reloaded).not.toBeNull();
    expect(reloaded!.status).toBe('SENDING');
    expect(reloaded!.attempts).toBe(1);
    expect(reloaded!.createdAt).toBeInstanceOf(Date);
    expect(reloaded!.updatedAt).toBeInstanceOf(Date);
  });

  it('findByIdempotencyKey returns the correct version so subsequent saves do not falsely conflict', async () => {
    const repo = makeRepo();
    const execution = makeExecution();
    await repo.save(ctx, execution);

    const viaIdempotencyKey = await repo.findByIdempotencyKey(ctx, 'idem-1');
    expect(viaIdempotencyKey).not.toBeNull();
    viaIdempotencyKey!.startDrafting(asCorrelationId('c2'), asEventId('e2'));
    await expect(repo.save(ctx, viaIdempotencyKey!)).resolves.not.toThrow();
  });

  it('findBySequence returns matching executions with correct version', async () => {
    const repo = makeRepo();
    const execution = makeExecution();
    await repo.save(ctx, execution);

    const [found] = await repo.findBySequence(ctx, execution.sequenceId);
    expect(found.id).toBe(execution.id);
    found.startDrafting(asCorrelationId('c2'), asEventId('e2'));
    await expect(repo.save(ctx, found)).resolves.not.toThrow();
  });

  it('round-trips every execution lifecycle field separately and never mixes synthetic ProjectX IDs with real provider IDs', async () => {
    const repo = makeRepo();
    const execution = makeExecution();

    execution.startDrafting(asCorrelationId('c2'), asEventId('e2'));
    execution.setDraft(
      'msg-1' as any,
      { subject: 'Hello', body: '<p>Hello</p>', cta: 'Reply' } as any,
      asCorrelationId('c3'),
      asEventId('e3'),
    );
    execution.approve('approval-1' as any, asCorrelationId('c4'), asEventId('e4'));
    execution.markSending(asCorrelationId('c5'), asEventId('e5'));
    execution.markProviderAttempt('graph-email');
    execution.markProviderAccepted(
      '<real-provider-message@example.com>',
      '<real-internet-message@example.com>',
      'ACCEPTED_202',
      asCorrelationId('c6'),
      asEventId('e6'),
    );
    execution.markDeliveryPending(asCorrelationId('c7'), asEventId('e7'));
    execution.markDelivered('<real-internet-message@example.com>', asCorrelationId('c8'), asEventId('e8'));

    await repo.save(ctx, execution);
    const reloaded = await repo.load(ctx, execution.id);

    expect(reloaded).not.toBeNull();
    expect(reloaded!.id).toBe(execution.id);
    expect(reloaded!.idempotencyKey).toBe(asIdempotencyKey('idem-1'));
    expect(reloaded!.providerId).toBe('graph-email');
    expect(reloaded!.providerMessageId).toBe('<real-provider-message@example.com>');
    expect(reloaded!.internetMessageId).toBe('<real-internet-message@example.com>');
    expect(reloaded!.providerErrorCode).toBe('ACCEPTED_202');
    expect(reloaded!.providerAcceptedAt).toBeInstanceOf(Date);
    expect(reloaded!.deliveredAt).toBeInstanceOf(Date);
    expect(reloaded!.status).toBe('DELIVERED');
    expect(reloaded!.providerMessageId).not.toContain('msg-1');
    expect(reloaded!.internetMessageId).not.toContain('msg-1');
  });

  it('round-trips failure timestamps and reason fields', async () => {
    const repo = makeRepo();
    const execution = makeExecution();

    execution.startDrafting(asCorrelationId('c2'), asEventId('e2'));
    execution.setDraft(
      'msg-1' as any,
      { subject: 'Hello', body: '<p>Hello</p>', cta: 'Reply' } as any,
      asCorrelationId('c3'),
      asEventId('e3'),
    );
    execution.approve('approval-1' as any, asCorrelationId('c4'), asEventId('e4'));
    execution.markSending(asCorrelationId('c5'), asEventId('e5'));
    execution.markFailed('NON_RETRYABLE', 'Provider rejected the request', 'REJECTED', asCorrelationId('c6'), asEventId('e6'));

    await repo.save(ctx, execution);
    const reloaded = await repo.load(ctx, execution.id);

    expect(reloaded).not.toBeNull();
    expect(reloaded!.status).toBe('FAILED_PRE_SUBMISSION');
    expect(reloaded!.lastError).toBe('Provider rejected the request');
    expect(reloaded!.providerErrorCode).toBe('REJECTED');
    expect(reloaded!.retryClassification).toBe('NON_RETRYABLE');
    expect(reloaded!.failedAt).toBeInstanceOf(Date);
  });
});
