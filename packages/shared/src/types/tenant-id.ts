/**
 * Branded UUID type for tenant identifiers to prevent accidental cross-tenant usage.
 */
export type TenantId = string & { readonly __brand: 'TenantId' };

export function asTenantId(value: string): TenantId {
  return value as TenantId;
}
