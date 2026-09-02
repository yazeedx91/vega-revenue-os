import type { TenantId } from '@projectx/shared';
import { TenantIsolationError } from '../errors/domain-errors';
import type { TenantContext } from './tenant-context';

export function requireTenant(context: TenantContext | undefined): TenantId {
  if (!context?.tenantId) {
    throw new TenantIsolationError('Tenant context is required');
  }
  return context.tenantId;
}

export function ensureSameTenant(context: TenantContext, tenantId: TenantId): void {
  if (context.tenantId !== tenantId) {
    throw new TenantIsolationError('Cross-tenant access detected');
  }
}
