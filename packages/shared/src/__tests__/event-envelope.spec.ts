import type { EventEnvelope } from '../contracts/event-envelope';
import { asTenantId } from '../types/tenant-id';
import { asCorrelationId, asEventId } from '../types/correlation';

describe('EventEnvelope', () => {
  it('contains the required contract fields', () => {
    const envelope: EventEnvelope<unknown> = {
      eventId: asEventId('evt-1'),
      eventType: 'AgentExecutionStarted',
      eventVersion: '1.0.0',
      occurredAt: new Date(),
      tenantId: asTenantId('tenant-1'),
      correlationId: asCorrelationId('corr-1'),
      producer: 'ai-runtime',
      payload: {},
    };

    expect(envelope.eventId).toBe('evt-1');
    expect(envelope.tenantId).toBe('tenant-1');
    expect(envelope.correlationId).toBe('corr-1');
    expect(envelope.producer).toBe('ai-runtime');
  });
});
