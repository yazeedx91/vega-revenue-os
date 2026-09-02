import { InMemoryTenantEmailConfigRepository } from '../../in-memory-tenant-email-config-repository';
import { GraphTenantResolver } from '../graph-tenant-resolver';

describe('GraphTenantResolver', () => {
  function makeResolver() {
    const repo = new InMemoryTenantEmailConfigRepository();
    repo.seed({
      tenantId: 'tenant-a',
      providerId: 'graph-email',
      channel: 'email',
      fromAddress: 'sales@tenant-a.example.com',
      allowedDomains: ['tenant-a.example.com'],
      webhookSecretReference: 'tenant-a-webhook-secret',
    });
    return new GraphTenantResolver(repo);
  }

  describe('extractMailbox', () => {
    it('extracts the mailbox from a well-formed resource path', () => {
      const resolver = makeResolver();
      expect(resolver.extractMailbox('Users/sales@tenant-a.example.com/Messages/msg-1')).toBe('sales@tenant-a.example.com');
    });

    it('is case-insensitive on the Users/Messages segments', () => {
      const resolver = makeResolver();
      expect(resolver.extractMailbox('users/sales@tenant-a.example.com/messages/msg-1')).toBe('sales@tenant-a.example.com');
    });

    it('returns null for an unrecognized resource shape', () => {
      const resolver = makeResolver();
      expect(resolver.extractMailbox('Groups/some-group/Messages/msg-1')).toBeNull();
    });
  });

  describe('resolve', () => {
    it('resolves a registered mailbox to its tenant config', async () => {
      const resolver = makeResolver();
      const result = await resolver.resolve('Users/sales@tenant-a.example.com/Messages/msg-1');
      expect(result).toEqual({ status: 'RESOLVED', config: expect.objectContaining({ tenantId: 'tenant-a' }) });
    });

    it('is case-insensitive on the mailbox address', async () => {
      const resolver = makeResolver();
      const result = await resolver.resolve('Users/SALES@TENANT-A.EXAMPLE.COM/Messages/msg-1');
      expect(result.status).toBe('RESOLVED');
    });

    it('returns NOT_FOUND for an unregistered mailbox', async () => {
      const resolver = makeResolver();
      const result = await resolver.resolve('Users/unknown@other.example.com/Messages/msg-1');
      expect(result.status).toBe('NOT_FOUND');
    });

    it('returns NOT_FOUND when the resource cannot be parsed', async () => {
      const resolver = makeResolver();
      const result = await resolver.resolve('not-a-valid-resource');
      expect(result.status).toBe('NOT_FOUND');
    });
  });
});
