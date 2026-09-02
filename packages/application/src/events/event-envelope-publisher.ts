import type { DomainEvent } from '@projectx/domain';
import type { IEventBus } from '@projectx/infrastructure';
import type { EventEnvelope } from '@projectx/shared';
import { IEventPublisher } from '../ports/event-publisher';

export class EventEnvelopePublisher implements IEventPublisher {
  constructor(private readonly eventBus: IEventBus) {}

  async publish(events: readonly DomainEvent<unknown>[]): Promise<void> {
    for (const event of events) {
      const envelope: EventEnvelope = {
        eventId: event.eventId,
        eventType: event.eventType,
        eventVersion: event.eventVersion,
        occurredAt: event.occurredAt,
        tenantId: event.tenantId,
        correlationId: event.correlationId,
        causationId: event.causationId,
        producer: event.producer,
        payload: event.payload,
        metadata: {},
      };
      await this.eventBus.publish(envelope);
    }
  }
}
