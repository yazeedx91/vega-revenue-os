import type { CausationId, CorrelationId, EventId } from '../types/correlation';
import type { TenantId } from '../types/tenant-id';

/**
 * Standard event envelope for all domain and integration events.
 * The infrastructure guarantees at-least-once delivery;
 * idempotency and deduplication are consumer responsibilities.
 */
export interface EventEnvelope<TPayload = unknown> {
  eventId: EventId;
  eventType: string;
  eventVersion: string;
  occurredAt: Date;
  tenantId: TenantId;
  correlationId: CorrelationId;
  causationId?: CausationId;
  producer: string;
  payload: TPayload;
  metadata?: Record<string, unknown>;
}

export interface CommandEnvelope<TPayload = unknown> {
  commandId: EventId;
  commandType: string;
  commandVersion: string;
  tenantId: TenantId;
  correlationId: CorrelationId;
  causationId?: CausationId;
  producer: string;
  payload: TPayload;
  metadata?: Record<string, unknown>;
}
