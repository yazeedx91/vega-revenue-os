/**
 * Thrown when a persistence operation violates a domain uniqueness constraint
 * (e.g. duplicate normalized_domain within a workspace). Distinct from
 * ConcurrencyConflictError which represents optimistic-concurrency / PK
 * collisions.
 */
export class DuplicateRecordError extends Error {
  constructor(
    message: string,
    public readonly tenantId: string,
    public readonly aggregateId: string,
    public readonly conflictField?: string,
  ) {
    super(message);
    this.name = 'DuplicateRecordError';
  }
}
