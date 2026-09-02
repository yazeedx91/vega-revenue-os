import type { IdempotencyKey } from '@projectx/shared';
import type { IIdempotencyStore } from '../ports/idempotency-store.interface';

export class InMemoryIdempotencyStore implements IIdempotencyStore {
  private readonly entries = new Map<string, unknown>();

  async get<T>(key: IdempotencyKey): Promise<T | undefined> {
    return this.entries.get(key) as T | undefined;
  }

  async set<T>(key: IdempotencyKey, value: T): Promise<void> {
    this.entries.set(key, value);
  }

  clear(): void {
    this.entries.clear();
  }
}
