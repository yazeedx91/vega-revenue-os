import type { AggregateRoot, IRepository, IUnitOfWork } from '@projectx/domain';

/**
 * Factory for tenant-scoped repositories and units of work.
 */
export interface IPersistenceProvider {
  repository<T extends AggregateRoot<string>>(name: string): IRepository<T>;
  unitOfWork(): IUnitOfWork;
}
