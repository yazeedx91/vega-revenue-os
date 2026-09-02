import type { DomainEvent } from '@projectx/domain';

export interface IEventPublisher {
  publish(events: readonly DomainEvent<unknown>[]): Promise<void>;
}
