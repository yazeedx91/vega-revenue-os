import type { CommandEnvelope, EventEnvelope } from '@projectx/shared';

/**
 * Infrastructure-agnostic event bus.
 * Implementations must guarantee at-least-once delivery;
 * consumers are responsible for idempotency and deduplication.
 */
export interface IEventBus {
  publish<TPayload = unknown>(event: EventEnvelope<TPayload>): Promise<void>;
  sendCommand<TPayload = unknown>(command: CommandEnvelope<TPayload>): Promise<void>;
  subscribe<TPayload = unknown>(
    eventType: string,
    handler: (event: EventEnvelope<TPayload>) => Promise<void>,
  ): Promise<void>;
}
