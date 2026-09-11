import { OutreachMessageExecution } from '@projectx/domain';
import type { TenantContext } from '@projectx/domain';
import { asCampaignId, asCorrelationId, asEventId, asIdempotencyKey, asOutreachExecutionId, asSequenceId, asTenantId } from '@projectx/shared';
import { InMemoryMessageExecutionRepository } from '../../in-memory-message-execution-repository';
import { GraphReplyCorrelator } from '../graph-reply-correlator';
import type { GraphNormalizedReply } from '../graph-message-normalizer';
import type { GraphSubscriptionRecord } from '../../ports/graph-subscription-repository.interface';
import type { IHistoricalRecipientFingerprint } from '../../ports/outbound-recipient-recovery.interface';

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

const ctx: TenantContext = { tenantId: asTenantId('tenant-a'), workspaceId: 'workspace-1', correlationId: asCorrelationId('corr-1') };

const fakeHistorical: IHistoricalRecipientFingerprint = {
  fingerprintEmailForVersion: async (_tenantId: string, rawEmail: string, keyVersion: string) => `h1.${keyVersion}.${rawEmail}`,
};

function makeSubscription(scope: 'WORKSPACE_BOUND' | 'LEGACY_UNBOUND', workspaceId: string | null): GraphSubscriptionRecord {
  return {
    tenantId: 'tenant-a',
    subscriptionId: `sub-${scope}`,
    subscriptionScope: scope,
    workspaceId,
    resource: `Users/sales@tenant-a.example.com/Messages`,
    notificationUrl: 'https://example.com/webhook',
    clientState: 'secret',
    expirationDateTime: new Date(Date.now() + 86400000),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

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
  overrides: {
    id?: string;
    workspaceId?: string;
    leadId?: string;
    recipientFingerprint?: string;
    providerMessageId?: string;
    idempotencyKeySuffix?: string;
  } = {},
) {
  const execution = OutreachMessageExecution.create(
    {
      id: asOutreachExecutionId(overrides.id ?? nextId('exec')),
      tenantId: ctx.tenantId,
      workspaceId: overrides.workspaceId ?? 'workspace-1',
      campaignId: asCampaignId('camp-1'),
      sequenceId: asSequenceId('seq-1'),
      stepNumber: 1,
      leadId: overrides.leadId ?? 'lead-1',
      contactId: 'contact-1',
      recipientFingerprint: overrides.recipientFingerprint ?? 'h1.1.prospect@example.com',
      recipientCiphertext: 'e1.1.ciphertext456',
      recipientProtectionState: 'PROTECTED',
      channel: 'email',
      idempotencyKey: asIdempotencyKey(`idmp-${overrides.idempotencyKeySuffix ?? nextId('idmp')}`),
    },
    ctx.correlationId,
    asEventId(nextId('evt')),
  );

  const providerMessageId = overrides.providerMessageId ?? `dummy-${nextId('dummy')}`;
  execution.startDrafting(ctx.correlationId, asEventId(nextId('evt')));
  execution.setDraft(execution.messageId ?? (`msg-${nextId('msg')}` as never), {} as never, ctx.correlationId, asEventId(nextId('evt')));
  execution.approve(`approval-${nextId('approval')}` as never, ctx.correlationId, asEventId(nextId('evt')));
  execution.markSending(ctx.correlationId, asEventId(nextId('evt')));
  execution.markProviderAttempt('graph-email');
  execution.markProviderAccepted(providerMessageId, providerMessageId, undefined, ctx.correlationId, asEventId(nextId('evt')));
  execution.markDeliveryPending(ctx.correlationId, asEventId(nextId('evt')));

  const saveCtx: TenantContext = { ...ctx, workspaceId: execution.workspaceId };
  await repo.save(saveCtx as any, execution);
  return execution;
}

describe('GraphReplyCorrelator', () => {
  it('correlates via References when a matching providerMessageId is found', async () => {
    const repo = new InMemoryMessageExecutionRepository();
    await seedExecution(repo, { providerMessageId: 'outbound-1' });
    const correlator = new GraphReplyCorrelator({ messageExecutionRepository: repo, historicalRecipientFingerprint: fakeHistorical });

    const result = await correlator.correlate(
      ctx,
      makeSubscription('WORKSPACE_BOUND', 'workspace-1'),
      makeNormalized({ references: ['outbound-0', 'outbound-1'], sender: 'nomatch@example.com' }),
    );

    expect(result.status).toBe('CORRELATED');
    if (result.status !== 'CORRELATED') return;
    expect(result.matchedBy).toBe('REFERENCES');
  });

  it('correlates via real Graph internetMessageId captured from Sent Items', async () => {
    const realMessageId = '<real-msg-id@example.com>';
    const repo = new InMemoryMessageExecutionRepository();
    await seedExecution(repo, { providerMessageId: realMessageId });
    const correlator = new GraphReplyCorrelator({ messageExecutionRepository: repo, historicalRecipientFingerprint: fakeHistorical });

    const result = await correlator.correlate(
      ctx,
      makeSubscription('WORKSPACE_BOUND', 'workspace-1'),
      makeNormalized({ inReplyTo: realMessageId, sender: 'prospect@example.com' }),
    );

    expect(result.status).toBe('CORRELATED');
    if (result.status !== 'CORRELATED') return;
    expect(result.matchedBy).toBe('IN_REPLY_TO');
    expect(result.execution?.providerMessageId).toBe(realMessageId);
  });

  it('correlates via In-Reply-To when References does not match', async () => {
    const repo = new InMemoryMessageExecutionRepository();
    await seedExecution(repo, { providerMessageId: 'outbound-1' });
    const correlator = new GraphReplyCorrelator({ messageExecutionRepository: repo, historicalRecipientFingerprint: fakeHistorical });

    const result = await correlator.correlate(
      ctx,
      makeSubscription('WORKSPACE_BOUND', 'workspace-1'),
      makeNormalized({ inReplyTo: 'outbound-1', sender: 'nomatch@example.com' }),
    );

    expect(result.status).toBe('CORRELATED');
    if (result.status !== 'CORRELATED') return;
    expect(result.matchedBy).toBe('IN_REPLY_TO');
  });

  it('correlates via providerMessageId when no References/In-Reply-To match', async () => {
    const repo = new InMemoryMessageExecutionRepository();
    await seedExecution(repo, { providerMessageId: 'graph-msg-1' });
    const correlator = new GraphReplyCorrelator({ messageExecutionRepository: repo, historicalRecipientFingerprint: fakeHistorical });

    const result = await correlator.correlate(
      ctx,
      makeSubscription('WORKSPACE_BOUND', 'workspace-1'),
      makeNormalized({ providerMessageId: 'graph-msg-1', sender: 'nomatch@example.com' }),
    );

    expect(result.status).toBe('CORRELATED');
    if (result.status !== 'CORRELATED') return;
    expect(result.matchedBy).toBe('PROVIDER_MESSAGE_ID');
  });

  it('WORKSPACE_BOUND exact match must stay within the authenticated workspace', async () => {
    const repo = new InMemoryMessageExecutionRepository();
    await seedExecution(repo, { id: 'exec-wrong', workspaceId: 'workspace-2', providerMessageId: 'outbound-1' });
    const correlator = new GraphReplyCorrelator({ messageExecutionRepository: repo, historicalRecipientFingerprint: fakeHistorical });

    const result = await correlator.correlate(
      ctx,
      makeSubscription('WORKSPACE_BOUND', 'workspace-1'),
      makeNormalized({ inReplyTo: 'outbound-1' }),
    );

    expect(result.status).toBe('NOT_CORRELATED');
  });

  it('WORKSPACE_BOUND + provider ID returns exact scoped correlation', async () => {
    const repo = new InMemoryMessageExecutionRepository();
    const execution = await seedExecution(repo, { providerMessageId: 'outbound-1' });
    const correlator = new GraphReplyCorrelator({ messageExecutionRepository: repo, historicalRecipientFingerprint: fakeHistorical });

    const result = await correlator.correlate(
      ctx,
      makeSubscription('WORKSPACE_BOUND', 'workspace-1'),
      makeNormalized({ inReplyTo: 'outbound-1' }),
    );

    expect(result.status).toBe('CORRELATED');
    if (result.status !== 'CORRELATED') return;
    expect(result.execution?.id).toBe(execution.id);
    expect(result.workspaceId).toBe('workspace-1');
  });

  it('LEGACY_UNBOUND + unique exact provider ID derives workspace from execution', async () => {
    const repo = new InMemoryMessageExecutionRepository();
    const execution = await seedExecution(repo, { id: 'exec-legacy', providerMessageId: 'outbound-1' });
    const correlator = new GraphReplyCorrelator({ messageExecutionRepository: repo, historicalRecipientFingerprint: fakeHistorical });

    const result = await correlator.correlate(
      { tenantId: ctx.tenantId, correlationId: ctx.correlationId },
      makeSubscription('LEGACY_UNBOUND', null),
      makeNormalized({ inReplyTo: 'outbound-1' }),
    );

    expect(result.status).toBe('CORRELATED');
    if (result.status !== 'CORRELATED') return;
    expect(result.execution?.id).toBe(execution.id);
    expect(result.workspaceId).toBe('workspace-1');
  });

  it('LEGACY_UNBOUND + fingerprint only is rejected', async () => {
    const repo = new InMemoryMessageExecutionRepository();
    await seedExecution(repo, { recipientFingerprint: 'h1.1.prospect@example.com' });
    const correlator = new GraphReplyCorrelator({ messageExecutionRepository: repo, historicalRecipientFingerprint: fakeHistorical });

    const result = await correlator.correlate(
      { tenantId: ctx.tenantId, correlationId: ctx.correlationId },
      makeSubscription('LEGACY_UNBOUND', null),
      makeNormalized({ sender: 'prospect@example.com' }),
    );

    expect(result.status).toBe('NOT_CORRELATED');
  });

  it('LEGACY_UNBOUND + ambiguous exact ID fails closed', async () => {
    const repo = new InMemoryMessageExecutionRepository();
    await seedExecution(repo, { id: 'exec-a', providerMessageId: 'outbound-1' });
    await seedExecution(repo, { id: 'exec-b', providerMessageId: 'outbound-1' });
    const correlator = new GraphReplyCorrelator({ messageExecutionRepository: repo, historicalRecipientFingerprint: fakeHistorical });

    const result = await correlator.correlate(
      { tenantId: ctx.tenantId, correlationId: ctx.correlationId },
      makeSubscription('LEGACY_UNBOUND', null),
      makeNormalized({ inReplyTo: 'outbound-1' }),
    );

    expect(result.status).toBe('NOT_CORRELATED');
  });

  it('WORKSPACE_BOUND + fingerprint fallback finds exact execution', async () => {
    const repo = new InMemoryMessageExecutionRepository();
    const execution = await seedExecution(repo, { recipientFingerprint: 'h1.1.prospect@example.com' });
    const correlator = new GraphReplyCorrelator({ messageExecutionRepository: repo, historicalRecipientFingerprint: fakeHistorical });

    const result = await correlator.correlate(
      ctx,
      makeSubscription('WORKSPACE_BOUND', 'workspace-1'),
      makeNormalized({ sender: 'prospect@example.com' }),
    );

    expect(result.status).toBe('CORRELATED');
    if (result.status !== 'CORRELATED') return;
    expect(result.execution?.id).toBe(execution.id);
    expect(result.matchedBy).toBe('SENDER_RECIPIENT_FALLBACK');
  });

  it('repeated executions to same recipient lead to Lead-level correlation', async () => {
    const repo = new InMemoryMessageExecutionRepository();
    await seedExecution(repo, { id: 'exec-a', idempotencyKeySuffix: 'a', recipientFingerprint: 'h1.1.prospect@example.com' });
    await seedExecution(repo, { id: 'exec-b', idempotencyKeySuffix: 'b', recipientFingerprint: 'h1.1.prospect@example.com' });
    const correlator = new GraphReplyCorrelator({ messageExecutionRepository: repo, historicalRecipientFingerprint: fakeHistorical });

    const result = await correlator.correlate(
      ctx,
      makeSubscription('WORKSPACE_BOUND', 'workspace-1'),
      makeNormalized({ sender: 'prospect@example.com' }),
    );

    expect(result.status).toBe('CORRELATED');
    if (result.status !== 'CORRELATED') return;
    expect(result.execution).toBeUndefined();
    expect(result.leadId).toBe('lead-1');
  });

  it('multiple Leads for same sender returns NOT_CORRELATED', async () => {
    const repo = new InMemoryMessageExecutionRepository();
    await seedExecution(repo, { id: 'exec-a', leadId: 'lead-a', idempotencyKeySuffix: 'a', recipientFingerprint: 'h1.1.prospect@example.com' });
    await seedExecution(repo, { id: 'exec-b', leadId: 'lead-b', idempotencyKeySuffix: 'b', recipientFingerprint: 'h1.1.prospect@example.com' });
    const correlator = new GraphReplyCorrelator({ messageExecutionRepository: repo, historicalRecipientFingerprint: fakeHistorical });

    const result = await correlator.correlate(
      ctx,
      makeSubscription('WORKSPACE_BOUND', 'workspace-1'),
      makeNormalized({ sender: 'prospect@example.com' }),
    );

    expect(result.status).toBe('NOT_CORRELATED');
  });

  it('historical HMAC key retained allows fallback', async () => {
    const repo = new InMemoryMessageExecutionRepository();
    await seedExecution(repo, { recipientFingerprint: 'h1.v1.prospect@example.com' });
    const retainedHistorical: IHistoricalRecipientFingerprint = {
      fingerprintEmailForVersion: async (_tenantId: string, rawEmail: string, keyVersion: string) =>
        keyVersion === 'v1' ? `h1.${keyVersion}.${rawEmail}` : Promise.reject(new Error('missing key')),
    };
    const correlator = new GraphReplyCorrelator({ messageExecutionRepository: repo, historicalRecipientFingerprint: retainedHistorical });

    const result = await correlator.correlate(
      ctx,
      makeSubscription('WORKSPACE_BOUND', 'workspace-1'),
      makeNormalized({ sender: 'prospect@example.com' }),
    );

    expect(result.status).toBe('CORRELATED');
  });

  it('missing historical HMAC key fails closed', async () => {
    const repo = new InMemoryMessageExecutionRepository();
    await seedExecution(repo, { recipientFingerprint: 'h1.v1.prospect@example.com' });
    const missingHistorical: IHistoricalRecipientFingerprint = {
      fingerprintEmailForVersion: async () => Promise.reject(new Error('missing key')),
    };
    const correlator = new GraphReplyCorrelator({ messageExecutionRepository: repo, historicalRecipientFingerprint: missingHistorical });

    const result = await correlator.correlate(
      ctx,
      makeSubscription('WORKSPACE_BOUND', 'workspace-1'),
      makeNormalized({ sender: 'prospect@example.com' }),
    );

    expect(result.status).toBe('NOT_CORRELATED');
  });

  it('returns NOT_CORRELATED when no candidate exists for the sender', async () => {
    const repo = new InMemoryMessageExecutionRepository();
    const correlator = new GraphReplyCorrelator({ messageExecutionRepository: repo, historicalRecipientFingerprint: fakeHistorical });

    const result = await correlator.correlate(
      ctx,
      makeSubscription('WORKSPACE_BOUND', 'workspace-1'),
      makeNormalized({ sender: 'unknown@example.com' }),
    );

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
        recipientFingerprint: 'h1.1.prospect@example.com',
        recipientCiphertext: 'e1.1.ciphertext',
        recipientProtectionState: 'PROTECTED',
        channel: 'email',
        idempotencyKey: asIdempotencyKey('idmp-other-tenant'),
      },
      otherCtx.correlationId,
      'evt-other' as never,
    );
    await repo.save(otherCtx as any, execution);
    const correlator = new GraphReplyCorrelator({ messageExecutionRepository: repo, historicalRecipientFingerprint: fakeHistorical });

    const result = await correlator.correlate(
      ctx,
      makeSubscription('WORKSPACE_BOUND', 'workspace-1'),
      makeNormalized({ sender: 'prospect@example.com' }),
    );

    expect(result.status).toBe('NOT_CORRELATED');
  });
});
