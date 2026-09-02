/**
 * Thrown by PostgresRepository.save() when an optimistic-concurrency check
 * fails: either the expected version no longer matches the stored version
 * (a concurrent writer updated the row first), or an insert targeted an id
 * that already exists (duplicate id on a supposedly-new aggregate).
 */
export class ConcurrencyConflictError extends Error {
  constructor(
    message: string,
    public readonly tenantId: string,
    public readonly aggregateId: string,
    public readonly expectedVersion: number | undefined,
  ) {
    super(message);
    this.name = 'ConcurrencyConflictError';
  }
}
