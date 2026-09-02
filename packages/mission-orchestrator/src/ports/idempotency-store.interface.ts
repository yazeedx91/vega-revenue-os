import type { IdempotencyKey } from '@projectx/shared';

export interface IIdempotencyStore {
  get<T>(key: IdempotencyKey): Promise<T | undefined>;
  set<T>(key: IdempotencyKey, value: T): Promise<void>;
}
