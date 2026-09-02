import type { TenantContext } from '../context/tenant-context';
import { asCorrelationId, asTenantId } from '@projectx/shared';

describe('TenantContext propagation', () => {
  it('carries branded tenant and correlation identifiers', () => {
    const ctx: TenantContext = {
      tenantId: asTenantId('tenant-123'),
      correlationId: asCorrelationId('corr-123'),
      userId: 'user-123',
    };

    expect(ctx.tenantId).toBe('tenant-123');
    expect(ctx.correlationId).toBe('corr-123');
  });
});
