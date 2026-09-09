import { asAccountId, asContactId, asCorrelationId, asEventId, asTenantId } from '@projectx/shared';
import { Contact, TenantIsolationError, AuthorizationError } from '@projectx/domain';
import { InMemoryContactRepository } from '../infrastructure/in-memory-intelligence-repositories';
import type { ContactRepositoryContext } from '@projectx/infrastructure';

const tenantId = () => asTenantId('tenant-1');
const corr = () => asCorrelationId('corr-1');
const evt = () => asEventId('evt-1');

function baseContactProps(overrides: Record<string, unknown> = {}) {
  return {
    id: asContactId('con-1'),
    tenantId: tenantId(),
    workspaceId: 'ws-1',
    accountId: asAccountId('acc-1'),
    name: 'Jane Doe',
    ...overrides,
  };
}

function ctx(tenantId: string, workspaceId: string): ContactRepositoryContext {
  return { tenantId, workspaceId };
}

describe('InMemoryContactRepository — workspace isolation', () => {
  let repo: InMemoryContactRepository;

  beforeEach(() => {
    repo = new InMemoryContactRepository();
  });

  describe('same workspace findById succeeds', () => {
    it('returns contact when tenant and workspace match', async () => {
      const contact = Contact.discover(baseContactProps(), 'provider', corr(), evt());
      await repo.save(ctx('tenant-1', 'ws-1'), contact);

      const found = await repo.findById(ctx('tenant-1', 'ws-1'), asContactId('con-1'));
      expect(found).not.toBeNull();
      expect(found?.id).toBe(asContactId('con-1'));
    });
  });

  describe('wrong workspace findById returns null', () => {
    it('returns null when workspace differs', async () => {
      const contact = Contact.discover(baseContactProps(), 'provider', corr(), evt());
      await repo.save(ctx('tenant-1', 'ws-1'), contact);

      const found = await repo.findById(ctx('tenant-1', 'ws-2'), asContactId('con-1'));
      expect(found).toBeNull();
    });

    it('returns null when tenant differs', async () => {
      const contact = Contact.discover(baseContactProps(), 'provider', corr(), evt());
      await repo.save(ctx('tenant-1', 'ws-1'), contact);

      const found = await repo.findById(ctx('tenant-2', 'ws-1'), asContactId('con-1'));
      expect(found).toBeNull();
    });
  });

  describe('findByAccount cannot leak another workspace', () => {
    it('filters by tenant, workspace, and account', async () => {
      const contact1 = Contact.discover(
        baseContactProps({ id: asContactId('con-1'), workspaceId: 'ws-1', accountId: asAccountId('acc-1') }),
        'provider',
        corr(),
        evt(),
      );
      const contact2 = Contact.discover(
        baseContactProps({ id: asContactId('con-2'), workspaceId: 'ws-2', accountId: asAccountId('acc-1') }),
        'provider',
        corr(),
        evt(),
      );
      const contact3 = Contact.discover(
        baseContactProps({ id: asContactId('con-3'), workspaceId: 'ws-1', accountId: asAccountId('acc-2') }),
        'provider',
        corr(),
        evt(),
      );

      await repo.save(ctx('tenant-1', 'ws-1'), contact1);
      await repo.save(ctx('tenant-1', 'ws-2'), contact2);
      await repo.save(ctx('tenant-1', 'ws-1'), contact3);

      const found = await repo.findByAccount(ctx('tenant-1', 'ws-1'), asAccountId('acc-1'));
      expect(found).toHaveLength(1);
      expect(found[0].id).toBe(asContactId('con-1'));
    });
  });

  describe('tenant mismatch save fails closed', () => {
    it('throws TenantIsolationError and leaves repository unchanged', async () => {
      const contact = Contact.discover(
        baseContactProps({ tenantId: asTenantId('tenant-2') }),
        'provider',
        corr(),
        evt(),
      );

      await expect(repo.save(ctx('tenant-1', 'ws-1'), contact)).rejects.toThrow(TenantIsolationError);

      const found = await repo.findById(ctx('tenant-1', 'ws-1'), asContactId('con-1'));
      expect(found).toBeNull();
    });
  });

  describe('workspace mismatch save fails closed', () => {
    it('throws AuthorizationError and leaves repository unchanged', async () => {
      const contact = Contact.discover(
        baseContactProps({ workspaceId: 'ws-2' }),
        'provider',
        corr(),
        evt(),
      );

      await expect(repo.save(ctx('tenant-1', 'ws-1'), contact)).rejects.toThrow(AuthorizationError);

      const found = await repo.findById(ctx('tenant-1', 'ws-1'), asContactId('con-1'));
      expect(found).toBeNull();
    });
  });

  describe('both failed saves leave repository unchanged', () => {
    it('tenant mismatch does not mutate store', async () => {
      const existing = Contact.discover(baseContactProps(), 'provider', corr(), evt());
      await repo.save(ctx('tenant-1', 'ws-1'), existing);

      const other = Contact.discover(
        baseContactProps({ id: asContactId('con-2'), tenantId: asTenantId('tenant-2') }),
        'provider',
        corr(),
        evt(),
      );

      await expect(repo.save(ctx('tenant-1', 'ws-1'), other)).rejects.toThrow(TenantIsolationError);

      const found = await repo.findById(ctx('tenant-1', 'ws-1'), asContactId('con-1'));
      expect(found).not.toBeNull();
      expect(found?.id).toBe(asContactId('con-1'));

      const otherFound = await repo.findById(ctx('tenant-1', 'ws-1'), asContactId('con-2'));
      expect(otherFound).toBeNull();
    });

    it('workspace mismatch does not mutate store', async () => {
      const existing = Contact.discover(baseContactProps(), 'provider', corr(), evt());
      await repo.save(ctx('tenant-1', 'ws-1'), existing);

      const other = Contact.discover(
        baseContactProps({ id: asContactId('con-2'), workspaceId: 'ws-2' }),
        'provider',
        corr(),
        evt(),
      );

      await expect(repo.save(ctx('tenant-1', 'ws-1'), other)).rejects.toThrow(AuthorizationError);

      const found = await repo.findById(ctx('tenant-1', 'ws-1'), asContactId('con-1'));
      expect(found).not.toBeNull();
      expect(found?.id).toBe(asContactId('con-1'));

      const otherFound = await repo.findById(ctx('tenant-1', 'ws-1'), asContactId('con-2'));
      expect(otherFound).toBeNull();
    });
  });
});
