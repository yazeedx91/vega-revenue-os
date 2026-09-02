import type { TenantContext } from '@projectx/domain';
import { OutreachMessageExecution } from '@projectx/domain';
import { InMemoryMessageExecutionRepository, InMemorySuppressionRepository } from '@projectx/outreach';
import { asCampaignId, asCorrelationId, asEventId, asIdempotencyKey, asOutreachExecutionId, asSequenceId, asTenantId } from '@projectx/shared';
import { persistReplyBasedOptOut } from '../application/persist-reply-opt-out';

const ctx: TenantContext = { tenantId: asTenantId('tenant-a'), correlationId: asCorrelationId('corr-1') };

describe('persistReplyBasedOptOut', () => {
  it('resolves the recipient address via the originating execution when executionId is present', async () => {
    const suppressionRepository = new InMemorySuppressionRepository();
    const messageExecutionRepository = new InMemoryMessageExecutionRepository();
    const execution = OutreachMessageExecution.create(
      {
        id: asOutreachExecutionId('exec-1'),
        tenantId: ctx.tenantId,
        campaignId: asCampaignId('camp-1'),
        sequenceId: asSequenceId('seq-1'),
        stepNumber: 1,
        leadId: 'lead-1',
        recipientAddress: 'prospect@example.com',
        channel: 'email',
        idempotencyKey: asIdempotencyKey('idmp-1'),
      },
      ctx.correlationId,
      asEventId('evt-1'),
    );
    await messageExecutionRepository.save(ctx, execution);

    await persistReplyBasedOptOut(
      ctx,
      { tenantId: 'tenant-a', leadId: 'lead-1' as any, channel: 'email', providerMessageId: 'p-1', content: 'stop', receivedAt: new Date(), executionId: 'exec-1' },
      { suppressionRepository, messageExecutionRepository },
    );

    const record = await suppressionRepository.isSuppressed(ctx, 'prospect@example.com');
    expect(record).not.toBeNull();
    expect(record!.suppressionType).toBe('OPT_OUT');
  });

  it('falls back to event.sender (the prospect address) when no executionId is present', async () => {
    const suppressionRepository = new InMemorySuppressionRepository();
    const messageExecutionRepository = new InMemoryMessageExecutionRepository();

    await persistReplyBasedOptOut(
      ctx,
      { tenantId: 'tenant-a', leadId: 'lead-1' as any, channel: 'email', providerMessageId: 'p-1', content: 'stop', receivedAt: new Date(), sender: 'prospect@example.com' },
      { suppressionRepository, messageExecutionRepository },
    );

    const record = await suppressionRepository.isSuppressed(ctx, 'prospect@example.com');
    expect(record).not.toBeNull();
  });

  it('never suppresses event.recipientAddress (the tenant mailbox), even when present', async () => {
    const suppressionRepository = new InMemorySuppressionRepository();
    const messageExecutionRepository = new InMemoryMessageExecutionRepository();

    await persistReplyBasedOptOut(
      ctx,
      {
        tenantId: 'tenant-a',
        leadId: 'lead-1' as any,
        channel: 'email',
        providerMessageId: 'p-1',
        content: 'stop',
        receivedAt: new Date(),
        sender: 'prospect@example.com',
        recipientAddress: 'sales@tenant-a.example.com',
      },
      { suppressionRepository, messageExecutionRepository },
    );

    expect(await suppressionRepository.isSuppressed(ctx, 'sales@tenant-a.example.com')).toBeNull();
    expect(await suppressionRepository.isSuppressed(ctx, 'prospect@example.com')).not.toBeNull();
  });

  it('is a no-op when neither executionId nor recipientAddress is available', async () => {
    const suppressionRepository = new InMemorySuppressionRepository();
    const messageExecutionRepository = new InMemoryMessageExecutionRepository();

    await expect(
      persistReplyBasedOptOut(
        ctx,
        { tenantId: 'tenant-a', leadId: 'lead-1' as any, channel: 'email', providerMessageId: 'p-1', content: 'stop', receivedAt: new Date() },
        { suppressionRepository, messageExecutionRepository },
      ),
    ).resolves.not.toThrow();

    expect(await suppressionRepository.list(ctx)).toHaveLength(0);
  });

  it('is a no-op when executionId is present but the execution cannot be found', async () => {
    const suppressionRepository = new InMemorySuppressionRepository();
    const messageExecutionRepository = new InMemoryMessageExecutionRepository();

    await persistReplyBasedOptOut(
      ctx,
      { tenantId: 'tenant-a', leadId: 'lead-1' as any, channel: 'email', providerMessageId: 'p-1', content: 'stop', receivedAt: new Date(), executionId: 'nonexistent' },
      { suppressionRepository, messageExecutionRepository },
    );

    expect(await suppressionRepository.list(ctx)).toHaveLength(0);
  });
});
