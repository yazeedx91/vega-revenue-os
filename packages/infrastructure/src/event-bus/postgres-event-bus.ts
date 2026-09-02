import type { Pool } from 'pg';
import type { CommandEnvelope, EventEnvelope } from '@projectx/shared';
import type { IEventBus } from './event-bus.interface';
import { PostgresClient } from '../persistence/postgres-client';

export interface PostgresEventBusConfig {
  pool: Pool;
}

export class PostgresEventBus implements IEventBus {
  private readonly client: PostgresClient;

  constructor(config: PostgresEventBusConfig) {
    this.client = new PostgresClient(config.pool);
  }

  async publish<TPayload = unknown>(event: EventEnvelope<TPayload>): Promise<void> {
    const sql = `
      INSERT INTO audit.integration_events
      (event_id, event_type, event_version, occurred_at, tenant_id, correlation_id, causation_id, producer, payload)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (event_id) DO NOTHING
    `;
    await this.client.query(sql, [
      event.eventId,
      event.eventType,
      event.eventVersion,
      event.occurredAt,
      event.tenantId,
      event.correlationId,
      event.causationId ?? null,
      event.producer,
      JSON.stringify(event.payload),
    ]);
  }

  async sendCommand<TPayload = unknown>(command: CommandEnvelope<TPayload>): Promise<void> {
    // Commands are persisted as integration events with a command-specific event type for traceability.
    const envelope: EventEnvelope<TPayload> = {
      eventId: command.commandId,
      eventType: `command:${command.commandType}`,
      eventVersion: command.commandVersion,
      occurredAt: new Date(),
      tenantId: command.tenantId,
      correlationId: command.correlationId,
      causationId: command.causationId,
      producer: command.producer,
      payload: command.payload,
      metadata: command.metadata,
    };
    await this.publish(envelope);
  }

  async subscribe<TPayload = unknown>(
    _eventType: string,
    _handler: (event: EventEnvelope<TPayload>) => Promise<void>,
  ): Promise<void> {
    // Subscriptions are out-of-process consumers in Phase 14; this adapter only appends events.
    // A background worker polls audit.integration_events for new records.
    return Promise.resolve();
  }
}
