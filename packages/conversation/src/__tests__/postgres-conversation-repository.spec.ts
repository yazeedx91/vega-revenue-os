import type { Pool } from 'pg';
import { Conversation, ReplyMessage } from '@projectx/domain';
import { FakePgPool } from '@projectx/infrastructure';
import { asConversationId, asCorrelationId, asEventId, asReplyMessageId, asTenantId } from '@projectx/shared';
import { PostgresConversationRepository } from '../infrastructure/postgres-conversation-repository';

describe('PostgresConversationRepository', () => {
  const tenantId = asTenantId('tenant-1');
  const ctx = { tenantId, correlationId: asCorrelationId('corr-1') };

  function makeConversation() {
    return Conversation.create(
      {
        id: asConversationId('conv-1'),
        tenantId,
        leadId: 'lead-1' as any,
        channel: 'email',
        executionId: 'exec-1',
      },
      asCorrelationId('corr-1'),
      asEventId('evt-1'),
    );
  }

  function makeRepo() {
    return new PostgresConversationRepository({ pool: new FakePgPool() as unknown as Pool });
  }

  it('reconstructs ReplyMessage as a real class instance with working getters after save/reload', async () => {
    const repo = makeRepo();
    const conversation = makeConversation();
    const reply = new ReplyMessage({
      id: asReplyMessageId('reply-1'),
      providerMessageId: 'provider-msg-1',
      channel: 'email',
      content: 'Sounds great, let us talk next week.',
      receivedAt: new Date('2026-01-15T10:00:00Z'),
    });
    conversation.recordReply(reply, asCorrelationId('c2'), asEventId('e2'));

    await repo.save(ctx, conversation);
    const reloaded = await repo.load(ctx, conversation.id);

    expect(reloaded).not.toBeNull();
    expect(reloaded!.messages).toHaveLength(1);

    const reloadedMessage = reloaded!.messages[0];
    // Must be a real ReplyMessage instance, not a plain JSON object — getters must work.
    expect(reloadedMessage).toBeInstanceOf(ReplyMessage);
    expect(reloadedMessage.content).toBe('Sounds great, let us talk next week.');
    expect(reloadedMessage.providerMessageId).toBe('provider-msg-1');
    expect(reloadedMessage.channel).toBe('email');
    expect(reloadedMessage.receivedAt).toBeInstanceOf(Date);
    expect(reloadedMessage.receivedAt.getTime()).toBe(new Date('2026-01-15T10:00:00Z').getTime());
  });

  it('preserves conversation status and supports further domain operations after reload', async () => {
    const repo = makeRepo();
    const conversation = makeConversation();
    const reply = new ReplyMessage({
      id: asReplyMessageId('reply-1'),
      providerMessageId: 'p-1',
      channel: 'email',
      content: 'ok',
      receivedAt: new Date(),
    });
    conversation.recordReply(reply, asCorrelationId('c2'), asEventId('e2'));
    await repo.save(ctx, conversation);

    const reloaded = await repo.load(ctx, conversation.id);
    expect(reloaded!.status).toBe('CLASSIFIED');

    // Behavior after reload must work identically to a freshly constructed aggregate.
    const result = reloaded!.classifyIntent(
      { intent: 'INTERESTED', confidence: 0.9, reason: 'positive reply' },
      asCorrelationId('c3'),
      asEventId('e3'),
    );
    expect(result.success).toBe(true);
  });

  it('round-trips the Phase 14 Milestone 6 canonical metadata fields through JSONB persistence', async () => {
    const repo = makeRepo();
    const conversation = makeConversation();
    const reply = new ReplyMessage({
      id: asReplyMessageId('reply-1'),
      providerMessageId: 'graph-msg-1',
      channel: 'email',
      content: 'Sounds good',
      receivedAt: new Date('2026-01-15T10:00:00Z'),
      messageIdHeader: '<msg-1@prospect.example.com>',
      sender: 'prospect@example.com',
      recipientAddress: 'sales@tenant-a.example.com',
      subject: 'Re: Hello',
      htmlBody: '<p>Sounds good</p>',
      inReplyTo: '<outbound-1@tenant-a.example.com>',
      references: ['<outbound-0@tenant-a.example.com>', '<outbound-1@tenant-a.example.com>'],
    });
    conversation.recordReply(reply, asCorrelationId('c2'), asEventId('e2'));

    await repo.save(ctx, conversation);
    const reloaded = await repo.load(ctx, conversation.id);
    const reloadedMessage = reloaded!.messages[0];

    expect(reloadedMessage.messageIdHeader).toBe('<msg-1@prospect.example.com>');
    expect(reloadedMessage.sender).toBe('prospect@example.com');
    expect(reloadedMessage.recipientAddress).toBe('sales@tenant-a.example.com');
    expect(reloadedMessage.subject).toBe('Re: Hello');
    expect(reloadedMessage.htmlBody).toBe('<p>Sounds good</p>');
    expect(reloadedMessage.inReplyTo).toBe('<outbound-1@tenant-a.example.com>');
    expect(reloadedMessage.references).toEqual(['<outbound-0@tenant-a.example.com>', '<outbound-1@tenant-a.example.com>']);
  });

  it('findByLeadAndChannel reconstructs ReplyMessage instances too', async () => {
    const repo = makeRepo();
    const conversation = makeConversation();
    const reply = new ReplyMessage({
      id: asReplyMessageId('reply-1'),
      providerMessageId: 'p-1',
      channel: 'email',
      content: 'via lead+channel lookup',
      receivedAt: new Date(),
    });
    conversation.recordReply(reply, asCorrelationId('c2'), asEventId('e2'));
    await repo.save(ctx, conversation);

    const found = await repo.findByLeadAndChannel(ctx, 'lead-1', 'email');
    expect(found).not.toBeNull();
    expect(found!.messages[0]).toBeInstanceOf(ReplyMessage);
    expect(found!.messages[0].content).toBe('via lead+channel lookup');
  });
});
