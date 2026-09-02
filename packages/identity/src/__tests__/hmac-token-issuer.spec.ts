import { HmacTokenIssuer } from '../infrastructure/hmac-token-issuer';
import { asTenantId } from '@projectx/shared';

describe('HmacTokenIssuer', () => {
  const issuer = new HmacTokenIssuer({
    secret: 'unit-test-secret',
    issuer: 'test-issuer',
    audience: 'test-audience',
    expirySeconds: 1,
  });

  it('issues a token that can be verified and returns the same user', async () => {
    const user = {
      userId: 'u-1',
      email: 'a@b.com',
      name: 'Test User' as string | null,
      tenantId: asTenantId('t-1'),
      workspaceId: 'w-1',
      roles: ['MEMBER'],
      permissions: ['workspace:read'],
    };
    const token = await issuer.issue(user);
    const verified = await issuer.verify(token);
    expect(verified).not.toBeNull();
    expect(verified?.userId).toBe('u-1');
    expect(verified?.tenantId).toBe(asTenantId('t-1'));
    expect(verified?.workspaceId).toBe('w-1');
    expect(verified?.permissions).toEqual(['workspace:read']);
  });

  it('rejects a tampered token', async () => {
    const token = (await issuer.issue({
      userId: 'u-1',
      email: 'a@b.com',
      name: null,
      tenantId: asTenantId('t-1'),
      workspaceId: 'w-1',
      roles: [],
      permissions: [],
    })) + 'x';
    const verified = await issuer.verify(token);
    expect(verified).toBeNull();
  });

  it('rejects a token with wrong audience/issuer', async () => {
    const other = new HmacTokenIssuer({
      secret: 'unit-test-secret',
      issuer: 'other',
      audience: 'other',
    });
    const token = await other.issue({
      userId: 'u-1',
      email: 'a@b.com',
      name: null,
      tenantId: asTenantId('t-1'),
      workspaceId: 'w-1',
      roles: [],
      permissions: [],
    });
    const verified = await issuer.verify(token);
    expect(verified).toBeNull();
  });
});
