import type { TenantContext } from '@projectx/domain';
import { asLeadId } from '@projectx/shared';
import { randomUUID } from 'crypto';
import { ConversationHandlingService } from '../application/conversation-handling.service';
import { DeterministicIntentClassifier } from '../infrastructure/deterministic-intent-classifier';
import { InMemoryConversationRepository } from '../infrastructure/in-memory-conversation-repository';
import { InMemoryLeadRepository } from '../infrastructure/in-memory-lead-repository';
import { InMemoryNextBestActionPolicy } from '../infrastructure/in-memory-next-best-action-policy';
import { RegexPIIScrubber } from '../infrastructure/regex-pii-scrubber';
import { NoOpPIIScrubber } from '../infrastructure/no-op-pii-scrubber';

const tenantA = 'tenant-a';

function ctx(correlationId = `corr-${randomUUID()}`): TenantContext {
  return { tenantId: tenantA as any, correlationId: correlationId as any };
}

function buildService(piiScrubber: { scrub(content: string): string } = new NoOpPIIScrubber()) {
  const conversationRepository = new InMemoryConversationRepository();
  const service = new ConversationHandlingService({
    conversationRepository,
    leadRepository: new InMemoryLeadRepository(),
    intentClassifier: new DeterministicIntentClassifier(),
    nextBestActionPolicy: new InMemoryNextBestActionPolicy(),
    piiScrubber,
    generateConversationId: () => randomUUID(),
    generateReplyMessageId: () => randomUUID(),
    generateEventId: () => randomUUID(),
  });
  return { service, conversationRepository };
}

describe('ConversationHandlingService — Phase 14 Milestone 6 extended fields', () => {
  it('persists the full canonical metadata round-trip onto the stored ReplyMessage', async () => {
    const { service, conversationRepository } = buildService();
    const c = ctx();
    const leadId = asLeadId('lead-1');

    const handled = await service.handleReply(c, {
      tenantId: tenantA,
      leadId,
      channel: 'email',
      providerMessageId: 'graph-msg-1',
      content: 'Sounds good',
      receivedAt: new Date('2026-01-01T00:00:00.000Z'),
      messageIdHeader: '<msg-1@prospect.example.com>',
      sender: 'prospect@example.com',
      recipientAddress: 'sales@tenant-a.example.com',
      subject: 'Re: Hello',
      htmlBody: '<p>Sounds good</p>',
      inReplyTo: '<outbound-1@tenant-a.example.com>',
      references: ['<outbound-0@tenant-a.example.com>', '<outbound-1@tenant-a.example.com>'],
    });

    const conversation = await service.load(c, handled.conversationId);
    expect(conversation).not.toBeNull();
    const reply = conversation!.messages[0];

    expect(reply.messageIdHeader).toBe('<msg-1@prospect.example.com>');
    expect(reply.sender).toBeUndefined();
    expect(reply.recipientAddress).toBeUndefined();
    expect(reply.subject).toBe('Re: Hello');
    expect(reply.htmlBody).toBe('<p>Sounds good</p>');
    expect(reply.inReplyTo).toBe('<outbound-1@tenant-a.example.com>');
    expect(reply.references).toEqual(['<outbound-0@tenant-a.example.com>', '<outbound-1@tenant-a.example.com>']);
  });

  it('remains backward compatible when only the original narrow fields are provided', async () => {
    const { service } = buildService();
    const c = ctx();

    const handled = await service.handleReply(c, {
      tenantId: tenantA,
      leadId: asLeadId('lead-1'),
      channel: 'email',
      providerMessageId: 'provider-1',
      content: 'Legacy caller, no extended fields',
      receivedAt: new Date(),
    });

    expect(handled.status).toBe('CLASSIFIED');
  });

  it('scrubs subject content through the PII scrubber, matching the content scrubbing boundary', async () => {
    const { service, conversationRepository } = buildService(new RegexPIIScrubber());
    const c = ctx();

    const handled = await service.handleReply(c, {
      tenantId: tenantA,
      leadId: asLeadId('lead-1'),
      channel: 'email',
      providerMessageId: 'provider-2',
      content: 'Reach me at prospect@example.com',
      receivedAt: new Date(),
      subject: 'Re: quote for prospect@example.com',
    });

    const conversation = await service.load(c, handled.conversationId);
    const reply = conversation!.messages[0];

    expect(reply.content).not.toContain('prospect@example.com');
    expect(reply.subject).not.toContain('prospect@example.com');
  });

  it('preserves htmlBody unscrubbed (already sanitized upstream, not fed to PII scrubber)', async () => {
    const { service } = buildService(new RegexPIIScrubber());
    const c = ctx();

    const handled = await service.handleReply(c, {
      tenantId: tenantA,
      leadId: asLeadId('lead-1'),
      channel: 'email',
      providerMessageId: 'provider-3',
      content: 'See details',
      receivedAt: new Date(),
      htmlBody: '<p>Contact prospect@example.com</p>',
    });

    const conversation = await service.load(c, handled.conversationId);
    const reply = conversation!.messages[0];

    expect(reply.htmlBody).toBe('<p>Contact prospect@example.com</p>');
  });

  it('handles missing optional fields without error', async () => {
    const { service } = buildService();
    const c = ctx();

    const handled = await service.handleReply(c, {
      tenantId: tenantA,
      leadId: asLeadId('lead-1'),
      channel: 'email',
      providerMessageId: 'provider-4',
      content: 'Minimal event',
      receivedAt: new Date(),
    });

    const conversation = await service.load(c, handled.conversationId);
    const reply = conversation!.messages[0];

    expect(reply.messageIdHeader).toBeUndefined();
    expect(reply.inReplyTo).toBeUndefined();
    expect(reply.references).toBeUndefined();
  });
});
