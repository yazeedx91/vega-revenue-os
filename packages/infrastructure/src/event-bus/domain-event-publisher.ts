import type { Pool } from 'pg';
import type { DomainEvent } from '@projectx/domain';
import type { TenantId } from '@projectx/shared';
import type { IEventPublisher } from './event-publisher.interface';
import { PostgresClient } from '../persistence/postgres-client';

export interface PostgresDomainEventPublisherConfig {
  pool: Pool;
  producer?: string;
}

export class PostgresDomainEventPublisher implements IEventPublisher {
  private readonly client: PostgresClient;
  private readonly producer: string;

  constructor(config: PostgresDomainEventPublisherConfig) {
    this.client = new PostgresClient(config.pool);
    this.producer = config.producer ?? 'projectx';
  }

  async publish(events: readonly DomainEvent<unknown>[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    // Group events by tenant to ensure RLS works per connection.
    const byTenant = new Map<string, DomainEvent<unknown>[]>();
    for (const event of events) {
      const list = byTenant.get(event.tenantId as string) ?? [];
      list.push(event);
      byTenant.set(event.tenantId as string, list);
    }

    for (const [tenantId, tenantEvents] of byTenant) {
      await this.client.withTenant(
        { tenantId: tenantId as TenantId, correlationId: tenantEvents[0].correlationId },
        async (client) => {
          for (const event of tenantEvents) {
            await client.query(
              `INSERT INTO audit.domain_events
               (event_id, event_type, event_version, occurred_at, tenant_id, correlation_id, causation_id, producer, payload)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               ON CONFLICT (event_id) DO NOTHING`,
              [
                event.eventId,
                event.eventType,
                event.eventVersion,
                event.occurredAt,
                event.tenantId as string,
                event.correlationId as string,
                event.causationId ?? null,
                this.producer,
                JSON.stringify(event.payload),
              ],
            );
          }
        },
      );
    }
  }
}
