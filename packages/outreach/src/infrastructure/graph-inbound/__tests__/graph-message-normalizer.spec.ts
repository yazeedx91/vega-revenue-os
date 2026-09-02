import { GraphMessageNormalizer } from '../graph-message-normalizer';
import type { GraphMessagePayload } from '../graph-inbound.types';

function makeMessage(overrides: Partial<GraphMessagePayload> = {}): GraphMessagePayload {
  return {
    id: 'graph-msg-1',
    internetMessageId: '<msg-1@prospect.example.com>',
    subject: 'Re: Hello',
    from: { emailAddress: { name: 'Prospect', address: 'prospect@example.com' } },
    toRecipients: [{ emailAddress: { name: 'Sales', address: 'sales@tenant-a.example.com' } }],
    body: { contentType: 'text', content: 'Thanks for reaching out.' },
    receivedDateTime: '2026-01-01T12:00:00.000Z',
    hasAttachments: false,
    internetMessageHeaders: [
      { name: 'In-Reply-To', value: '<outbound-1@tenant-a.example.com>' },
      { name: 'References', value: '<outbound-0@tenant-a.example.com> <outbound-1@tenant-a.example.com>' },
    ],
    ...overrides,
  };
}

describe('GraphMessageNormalizer', () => {
  it('normalizes sender/recipient identity correctly', () => {
    const result = new GraphMessageNormalizer().normalize(makeMessage());
    expect(result.status).toBe('NORMALIZED');
    if (result.status !== 'NORMALIZED') return;
    expect(result.event.sender).toBe('prospect@example.com');
    expect(result.event.recipientAddress).toBe('sales@tenant-a.example.com');
  });

  it('preserves full metadata round-trip', () => {
    const result = new GraphMessageNormalizer().normalize(makeMessage());
    expect(result.status).toBe('NORMALIZED');
    if (result.status !== 'NORMALIZED') return;
    expect(result.event.providerMessageId).toBe('graph-msg-1');
    expect(result.event.messageIdHeader).toBe('<msg-1@prospect.example.com>');
    expect(result.event.subject).toBe('Re: Hello');
    expect(result.event.content).toBe('Thanks for reaching out.');
    expect(result.event.inReplyTo).toBe('<outbound-1@tenant-a.example.com>');
    expect(result.event.references).toEqual(['<outbound-0@tenant-a.example.com>', '<outbound-1@tenant-a.example.com>']);
    expect(result.event.receivedAt).toEqual(new Date('2026-01-01T12:00:00.000Z'));
    expect(result.event.hadAttachments).toBe(false);
  });

  it('handles missing optional headers gracefully', () => {
    const result = new GraphMessageNormalizer().normalize(makeMessage({ internetMessageHeaders: undefined, internetMessageId: undefined }));
    expect(result.status).toBe('NORMALIZED');
    if (result.status !== 'NORMALIZED') return;
    expect(result.event.inReplyTo).toBeUndefined();
    expect(result.event.references).toBeUndefined();
    expect(result.event.messageIdHeader).toBeUndefined();
  });

  it('parses multiple References values', () => {
    const result = new GraphMessageNormalizer().normalize(
      makeMessage({ internetMessageHeaders: [{ name: 'References', value: '<a@x> <b@x> <c@x>' }] }),
    );
    expect(result.status).toBe('NORMALIZED');
    if (result.status !== 'NORMALIZED') return;
    expect(result.event.references).toEqual(['<a@x>', '<b@x>', '<c@x>']);
  });

  it('sanitizes an HTML body and derives plain-text content from it', () => {
    const result = new GraphMessageNormalizer().normalize(
      makeMessage({ body: { contentType: 'html', content: '<p>Hello <script>alert(1)</script>world</p>' } }),
    );
    expect(result.status).toBe('NORMALIZED');
    if (result.status !== 'NORMALIZED') return;
    expect(result.event.htmlBody).not.toContain('script');
    expect(result.event.content).toContain('Hello');
    expect(result.event.content).toContain('world');
    expect(result.event.content).not.toContain('<');
  });

  it('flags hadAttachments without fetching/storing any attachment content', () => {
    const result = new GraphMessageNormalizer().normalize(makeMessage({ hasAttachments: true }));
    expect(result.status).toBe('NORMALIZED');
    if (result.status !== 'NORMALIZED') return;
    expect(result.event.hadAttachments).toBe(true);
  });

  it('rejects a message with no id', () => {
    const result = new GraphMessageNormalizer().normalize(makeMessage({ id: undefined as unknown as string }));
    expect(result.status).toBe('MALFORMED');
  });

  it('rejects an invalid receivedDateTime', () => {
    const result = new GraphMessageNormalizer().normalize(makeMessage({ receivedDateTime: 'not-a-date' }));
    expect(result.status).toBe('MALFORMED');
  });

  it('rejects an oversized body', () => {
    const normalizer = new GraphMessageNormalizer({ maxBodyLength: 10 });
    const result = normalizer.normalize(makeMessage({ body: { contentType: 'text', content: 'x'.repeat(1000) } }));
    expect(result.status).toBe('OVERSIZED');
  });

  it('defaults to bodyPreview when body.content is absent', () => {
    const result = new GraphMessageNormalizer().normalize(makeMessage({ body: undefined, bodyPreview: 'preview text' }));
    expect(result.status).toBe('NORMALIZED');
    if (result.status !== 'NORMALIZED') return;
    expect(result.event.content).toBe('preview text');
  });
});
