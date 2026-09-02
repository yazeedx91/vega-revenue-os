import type { DomainEvent } from '@projectx/domain';
import { IEventPublisher } from '../ports/event-publisher';

export class CollectingEventPublisher implements IEventPublisher {
  readonly published: DomainEvent<unknown>[] = [];

  async publish(events: readonly DomainEvent<unknown>[]): Promise<void> {
    this.published.push(...events);
  }
}
