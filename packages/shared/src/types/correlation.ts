export type CorrelationId = string & { readonly __brand: 'CorrelationId' };
export type CausationId = string & { readonly __brand: 'CausationId' };
export type EventId = string & { readonly __brand: 'EventId' };
export type IdempotencyKey = string & { readonly __brand: 'IdempotencyKey' };

export function asCorrelationId(value: string): CorrelationId {
  return value as CorrelationId;
}

export function asCausationId(value: string): CausationId {
  return value as CausationId;
}

export function asEventId(value: string): EventId {
  return value as EventId;
}

export function asIdempotencyKey(value: string): IdempotencyKey {
  return value as IdempotencyKey;
}
