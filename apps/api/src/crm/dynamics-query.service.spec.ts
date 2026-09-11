import { asCorrelationId, asTenantId } from '@projectx/shared';
import { DynamicsQueryService } from './dynamics-query.service';

const ctx = { tenantId: asTenantId('tenant-a'), workspaceId: 'workspace-a', correlationId: asCorrelationId('crm-query') };

describe('DynamicsQueryService', () => {
  it('passes trusted context to the read adapter and returns approved account projection', async () => {
    let received: unknown;
    const service = new DynamicsQueryService({ findAccounts: async (context) => { received = context; return [{ providerAccountId: 'a', name: 'Account', raw: { secret: true } }]; } } as never);
    await expect(service.accounts(ctx, { limit: 10 })).resolves.toEqual([{ providerAccountId: 'a', name: 'Account' }]);
    expect(received).toBe(ctx);
  });

  it('removes external contact email, phone, and raw metadata from API DTOs', async () => {
    const service = new DynamicsQueryService({ findContacts: async () => [{ providerContactId: 'c', accountId: 'a', name: 'Contact', title: 'Director', email: 'external@example.test', phone: '+15550000000', raw: { provider: 'dynamics365' } }] } as never);
    const result = await service.contacts(ctx, 'a');
    expect(result).toEqual([{ providerContactId: 'c', accountId: 'a', name: 'Contact', title: 'Director' }]);
    expect(JSON.stringify(result)).not.toContain('external@example.test');
  });

  it('exposes read queries only', () => {
    const methods = Object.getOwnPropertyNames(DynamicsQueryService.prototype);
    expect(methods).toEqual(expect.arrayContaining(['accounts', 'contacts']));
    expect(methods).not.toEqual(expect.arrayContaining(['create', 'update', 'delete', 'writeBack']));
  });
});
