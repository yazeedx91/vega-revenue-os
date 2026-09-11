import { OutreachMessageExecution } from '@projectx/domain';
import type { TenantContext } from '@projectx/domain';
import { asCampaignId, asCorrelationId, asEventId, asIdempotencyKey, asOutreachExecutionId, asSequenceId, asTenantId } from '@projectx/shared';
import { InMemoryMessageExecutionRepository } from '../../in-memory-message-execution-repository';
import { GraphReplyCorrelator } from '../graph-reply-correlator';
import type { GraphNormalizedReply } from '../graph-message-normalizer';

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

const ctx: TenantContext = { tenantId: asTenantId('tenant-a'), workspaceId: 'workspace-1', correlationId: asCorrelationId('corr-1') };

function makeNormalized(overrides: Partial<GraphNormalizedReply> = {}): GraphNormalizedReply {
  return {
    channel: 'email',
    providerMessageId: 'graph-msg-1',
    content: 'Sounds good',
    receivedAt: new Date(),
    sender: 'prospect@example.com',
    recipientAddress: 'sales@tenant-a.example.com',
    hadAttachments: false,
    ...overrides,
  };
}

async function seedExecution(
  repo: InMemoryMessageExecutionRepository,
  overrides: { recipientFingerprint?: string; providerMessageId?: string; idempotencyKeySuffix?: string } = {},
) {
  const execution = OutreachMessageExecution.create(
    {
      id: asOutreachExecutionId(nextId('exec')),
      tenantId: ctx.tenantId,
      workspaceId: 'workspace-1',
      campaignId: asCampaignId('camp-1'),
      sequenceId: asSequenceId('seq-1'),
      stepNumber: 1,
      leadId: 'lead-1',
      contactId: 'contact-1',
      recipientFingerprint: overrides.recipientFingerprint ?? 'h1.1.fingerprint123',
      recipientCiphertext: 'e1.1.ciphertext456',
      recipientProtectionState: 'PROTECTED',
      channel: 'email',
      idempotencyKey: asIdempotencyKey(`idmp-${overrides.idempotencyKeySuffix ?? nextId('idmp')}`),
    },
    ctx.correlationId,
    asEventId(nextId('evt')),
  );

  if (overrides.providerMessageId) {
    execution.startDrafting(ctx.correlationId, asEventId(nextId('evt')));
    execution.setDraft(execution.messageId ?? (`msg-${nextId('msg')}` as never), {} as never, ctx.correlationId, asEventId(nextId('evt')));
    execution.approve(`approval-${nextId('approval')}` as never, ctx.correlationId, asEventId(nextId('evt')));
    execution.markSending(ctx.correlationId, asEventId(nextId('evt')));
    execution.markProviderAttempt('graph-email');
    execution.markProviderAccepted(
      overrides.providerMessageId,
      overrides.providerMessageId,
      undefined,
      ctx.correlationId,
      asEventId(nextId('evt')),
    );
    execution.markDeliveryPending(ctx.correlationId, asEventId(nextId('evt')));
  }

  await repo.save(ctx, execution);
  return execution;
}

describe('GraphReplyCorrelator', () => {
  it('correlates via References when a matching providerMessageId is found', async () => {
    const repo = new InMemoryMessageExecutionRepository();
    await seedExecution(repo, { providerMessageId: 'outbound-1' });
    const correlator = new GraphReplyCorrelator({ messageExecutionRepository: repo });

    const result = await correlator.correlate(ctx, makeNormalized({ references: ['outbound-0', 'outbound-1'], sender: 'nomatch@example.com' }));

    expect(result.status).toBe('CORRELATED');
    if (result.status !== 'CORRELATED') return;
    expect(result.matchedBy).toBe('REFERENCES');
  });

  it('correlates via real Graph internetMessageId captured from Sent Items', async () => {
    const realMessageId = '<real-msg-id@example.com>';
    const repo = new InMemoryMessageExecutionRepository();
    await seedExecution(repo, { providerMessageId: realMessageId });
    const correlator = new GraphReplyCorrelator({ messageExecutionRepository: repo });

    const result = await correlator.correlate(
      ctx,
      makeNormalized({ inReplyTo: realMessageId, sender: 'prospect@example.com' }),
    );

    expect(result.status).toBe('CORRELATED');
    if (result.status !== 'CORRELATED') return;
    expect(result.matchedBy).toBe('IN_REPLY_TO');
    expect(result.execution.providerMessageId).toBe(realMessageId);
  });

  it('correlates via In-Reply-To when References does not match', async () => {
    const repo = new InMemoryMessageExecutionRepository();
    await seedExecution(repo, { providerMessageId: 'outbound-1' });
    const correlator = new GraphReplyCorrelator({ messageExecutionRepository: repo });

    const result = await correlator.correlate(ctx, makeNormalized({ inReplyTo: 'outbound-1', sender: 'nomatch@example.com' }));

    expect(result.status).toBe('CORRELATED');
    if (result.status !== 'CORRELATED') return;
    expect(result.matchedBy).toBe('IN_REPLY_TO');
  });

  it('correlates via providerMessageId when no References/In-Reply-To match', async () => {
    const repo = new InMemoryMessageExecutionRepository();
    await seedExecution(repo, { providerMessageId: 'graph-msg-1' });
    const correlator = new GraphReplyCorrelator({ messageExecutionRepository: repo });

    const result = await correlator.correlate(ctx, makeNormalized({ providerMessageId: 'graph-msg-1', sender: 'nomatch@example.com' }));

    expect(result.status).toBe('CORRELATED');
    if (result.status !== 'CORRELATED') return;
    expect(result.matchedBy).toBe('PROVIDER_MESSAGE_ID');
  });

  it('returns NOT_CORRELATED for sender/recipient fallback until workspace-bound subscription is implemented', async () => {
    const repo = new InMemoryMessageExecutionRepository();
    await seedExecution(repo, { recipientFingerprint: 'h1.1.prospect' });
    const correlator = new GraphReplyCorrelator({ messageExecutionRepository: repo });

    const result = await correlator.correlate(ctx, makeNormalized({ sender: 'prospect@example.com' }));

    expect(result.status).toBe('NOT_CORRELATED');
    if (result.status === 'NOT_CORRELATED') {
      expect(result.reason).toContain('Protected recipient fallback requires an authenticated workspace-bound subscription');
    }
  });

  it('returns NOT_CORRELATED rather than guessing when multiple candidates share a sender until workspace-bound subscription is implemented', async () => {
    const repo = new InMemoryMessageExecutionRepository();
    await seedExecution(repo, { recipientFingerprint: 'h1.1.prospect', idempotencyKeySuffix: '1' });
    await seedExecution(repo, { recipientFingerprint: 'h1.1.prospect', idempotencyKeySuffix: '2' });
    const correlator = new GraphReplyCorrelator({ messageExecutionRepository: repo });

    const result = await correlator.correlate(ctx, makeNormalized({ sender: 'prospect@example.com' }));

    expect(result.status).toBe('NOT_CORRELATED');
  });

  it('returns NOT_CORRELATED when no candidate exists for the sender', async () => {
    const repo = new InMemoryMessageExecutionRepository();
    const correlator = new GraphReplyCorrelator({ messageExecutionRepository: repo });

    const result = await correlator.correlate(ctx, makeNormalized({ sender: 'unknown@example.com' }));

    expect(result.status).toBe('NOT_CORRELATED');
  });

  it('does not use the sender/recipient fallback when disabled by policy', async () => {
    const repo = new InMemoryMessageExecutionRepository();
    await seedExecution(repo, { recipientFingerprint: 'h1.1.prospect' });
    const correlator = new GraphReplyCorrelator({ messageExecutionRepository: repo, allowSenderRecipientFallback: false });

    const result = await correlator.correlate(ctx, makeNormalized({ sender: 'prospect@example.com' }));

    expect(result.status).toBe('NOT_CORRELATED');
  });

  it('never guesses across tenants: a same-sender execution in another tenant is invisible', async () => {
    const repo = new InMemoryMessageExecutionRepository();
    const otherCtx: TenantContext = { tenantId: asTenantId('tenant-b'), workspaceId: 'workspace-2', correlationId: asCorrelationId('corr-2') };
    const execution = OutreachMessageExecution.create(
      {
        tenantId: otherCtx.tenantId,
        workspaceId: 'workspace-2',
        campaignId: asCampaignId('camp-2'),
        sequenceId: asSequenceId('seq-2'),
        stepNumber: 1,
        leadId: 'lead-2',
        contactId: 'contact-2',
        recipientFingerprint: 'h1.1.prospect',
        recipientCiphertext: 'e1.1.ciphertext',
        recipientProtectionState: 'PROTECTED',
        channel: 'email',
        idempotencyKey: asIdempotencyKey('idmp-other-tenant'),
      },
      otherCtx.correlationId,
      'evt-other' as never,
    );
    await repo.save(otherCtx, execution);
    const correlator = new GraphReplyCorrelator({ messageExecutionRepository: repo });

    const result = await correlator.correlate(ctx, makeNormalized({ sender: 'prospect@example.com' }));

    expect(result.status).toBe('NOT_CORRELATED');
  });
});
