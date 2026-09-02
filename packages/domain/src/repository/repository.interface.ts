import type { TenantContext } from '../context/tenant-context';
import type { AggregateRoot } from '../aggregate/aggregate-root';

export interface IRepository<T extends AggregateRoot<TId>, TId extends string = string> {
  findById(ctx: TenantContext, id: TId): Promise<T | null>;
  save(ctx: TenantContext, aggregate: T): Promise<void>;
}
