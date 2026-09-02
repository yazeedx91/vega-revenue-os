import type { TenantContext } from '@projectx/domain';

/**
 * CRM provider abstraction behind an anti-corruption layer.
 * Concrete Dynamics 365 adapter to be implemented in a later phase.
 */
export interface ICRMProvider {
  readonly providerId: string;
  query<TEntity>(
    ctx: TenantContext,
    entityName: string,
    query: unknown,
  ): Promise<TEntity[]>;
  create<TEntity>(
    ctx: TenantContext,
    entityName: string,
    data: unknown,
  ): Promise<TEntity>;
  update<TEntity>(
    ctx: TenantContext,
    entityName: string,
    id: string,
    data: unknown,
  ): Promise<TEntity>;
  delete(ctx: TenantContext, entityName: string, id: string): Promise<void>;
}
