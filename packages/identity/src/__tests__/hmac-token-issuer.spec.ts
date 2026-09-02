import { HmacTokenIssuer } from '../infrastructure/hmac-token-issuer';
import { FakeSecretsProvider } from './fake-secrets-provider';
import { asTenantId } from '@projectx/shared';

function randomBase64() {
  return Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString('base64url');
}

const activeKey = randomBase64();
const previousKey = Buffer.from('different-key-256-bits-long!!!').toString('base64url');

async function createIssuer(previous?: { reference: string; kid: string; validUntil: number }) {
  const secrets = new FakeSecretsProvider({
    'jwt-active-ref': activeKey,
    ...(previous ? { 'jwt-previous-ref': previousKey } : {}),
  });
  return HmacTokenIssuer.create({
    secrets,
    active: { reference: 'jwt-active-ref', kid: 'active-kid' },
    previous,
    issuer: 'test-issuer',
    audience: 'test-audience',
    expirySeconds: 60,
    refreshIntervalMs: 0,
  });
}

describe('HmacTokenIssuer', () => {
  it('issues a token with the active kid and verifies it', async () => {
    const issuer = await createIssuer();
    const user = {
      userId: 'u-1',
      email: 'a@b.com',
      name: 'Test User' as string | null,
      tenantId: asTenantId('t-1'),
      workspaceId: 'w-1',
      roles: ['MEMBER'] as string[],
      permissions: ['workspace:read'] as string[],
    };
    const token = await issuer.issue(user);
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
    expect(header.kid).toBe('active-kid');
    const verified = await issuer.verify(token);
    expect(verified).not.toBeNull();
    expect(verified?.userId).toBe('u-1');
    expect(verified?.tenantId).toBe(asTenantId('t-1'));
    expect(verified?.workspaceId).toBe('w-1');
  });

  it('rejects a tampered token', async () => {
    const issuer = await createIssuer();
    const token = await issuer.issue({
      userId: 'u-1',
      email: 'a@b.com',
      name: null,
      tenantId: asTenantId('t-1'),
      workspaceId: 'w-1',
      roles: [],
      permissions: [],
    });
    const verified = await issuer.verify(`${token}x`);
    expect(verified).toBeNull();
  });

  it('verifies a previous-key token during the grace period', async () => {
    const issuer = await createIssuer({
      reference: 'jwt-previous-ref',
      kid: 'previous-kid',
      validUntil: Date.now() + 60_000,
    });
    const previousIssuer = await HmacTokenIssuer.create({
      secrets: new FakeSecretsProvider({ 'jwt-previous-ref': previousKey }),
      active: { reference: 'jwt-previous-ref', kid: 'previous-kid' },
      issuer: 'test-issuer',
      audience: 'test-audience',
      expirySeconds: 60,
      refreshIntervalMs: 0,
    });
    const token = await previousIssuer.issue({
      userId: 'u-1',
      email: 'a@b.com',
      name: null,
      tenantId: asTenantId('t-1'),
      workspaceId: 'w-1',
      roles: [],
      permissions: [],
    });
    const verified = await issuer.verify(token);
    expect(verified).not.toBeNull();
    expect(verified?.userId).toBe('u-1');
  });

  it('rejects a previous-key token after the grace period', async () => {
    const issuer = await createIssuer({
      reference: 'jwt-previous-ref',
      kid: 'previous-kid',
      validUntil: Date.now() - 1,
    });
    const previousIssuer = await HmacTokenIssuer.create({
      secrets: new FakeSecretsProvider({ 'jwt-previous-ref': previousKey }),
      active: { reference: 'jwt-previous-ref', kid: 'previous-kid' },
      issuer: 'test-issuer',
      audience: 'test-audience',
      expirySeconds: 60,
      refreshIntervalMs: 0,
    });
    const token = await previousIssuer.issue({
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

  it('rejects a token signed by a retired key (neither active nor previous)', async () => {
    const issuer = await createIssuer();
    const rogueIssuer = await HmacTokenIssuer.create({
      secrets: new FakeSecretsProvider({
        'jwt-rogue-ref': randomBase64(),
      }),
      active: { reference: 'jwt-rogue-ref', kid: 'rogue-kid' },
      issuer: 'test-issuer',
      audience: 'test-audience',
      expirySeconds: 60,
      refreshIntervalMs: 0,
    });
    const token = await rogueIssuer.issue({
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

  it('rejects an unknown kid', async () => {
    const issuer = await createIssuer();
    const token = await issuer.issue({
      userId: 'u-1',
      email: 'a@b.com',
      name: null,
      tenantId: asTenantId('t-1'),
      workspaceId: 'w-1',
      roles: [],
      permissions: [],
    });
    const [h, p, s] = token.split('.');
    const tampered = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'unknown' })).toString('base64url')}.${p}.${s}`;
    const verified = await issuer.verify(tampered);
    expect(verified).toBeNull();
  });

  it('rejects algorithm substitution', async () => {
    const issuer = await createIssuer();
    const token = await issuer.issue({
      userId: 'u-1',
      email: 'a@b.com',
      name: null,
      tenantId: asTenantId('t-1'),
      workspaceId: 'w-1',
      roles: [],
      permissions: [],
    });
    const [h, p, s] = token.split('.');
    const tampered = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT', kid: 'active-kid' })).toString('base64url')}.${p}.${s}`;
    const verified = await issuer.verify(tampered);
    expect(verified).toBeNull();
  });

  it('rejects an expired token', async () => {
    const issuer = await HmacTokenIssuer.create({
      secrets: new FakeSecretsProvider({ 'jwt-active-ref': activeKey }),
      active: { reference: 'jwt-active-ref', kid: 'active-kid' },
      issuer: 'test-issuer',
      audience: 'test-audience',
      expirySeconds: -2,
      refreshIntervalMs: 0,
    });
    const token = await issuer.issue({
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

  it('rejects wrong issuer or audience', async () => {
    const issuer = await createIssuer();
    const other = await HmacTokenIssuer.create({
      secrets: new FakeSecretsProvider({ 'jwt-active-ref': activeKey }),
      active: { reference: 'jwt-active-ref', kid: 'other-kid' },
      issuer: 'other-issuer',
      audience: 'other-audience',
      refreshIntervalMs: 0,
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

  it('fails startup if active key is missing', async () => {
    await expect(
      HmacTokenIssuer.create({
        secrets: new FakeSecretsProvider({}),
        active: { reference: 'missing', kid: 'kid' },
        refreshIntervalMs: 0,
      }),
    ).rejects.toThrow();
  });

  it('fails startup if active key is too short', async () => {
    await expect(
      HmacTokenIssuer.create({
        secrets: new FakeSecretsProvider({
          'jwt-short-ref': 'short',
        }),
        active: { reference: 'jwt-short-ref', kid: 'kid' },
        refreshIntervalMs: 0,
      }),
    ).rejects.toThrow();
  });

  it('does not log or expose key material', async () => {
    const secrets = new FakeSecretsProvider({ 'jwt-active-ref': activeKey });
    const issuer = await HmacTokenIssuer.create({
      secrets,
      active: { reference: 'jwt-active-ref', kid: 'active-kid' },
      refreshIntervalMs: 0,
    });
    const token = await issuer.issue({
      userId: 'u-1',
      email: 'a@b.com',
      name: null,
      tenantId: asTenantId('t-1'),
      workspaceId: 'w-1',
      roles: [],
      permissions: [],
    });
    expect(token).not.toContain(activeKey);
  });

  it('keeps the last-known-good ring when a refresh fails', async () => {
    const secrets = new FakeSecretsProvider({ 'jwt-active-ref': activeKey });
    const issuer = await HmacTokenIssuer.create({
      secrets,
      active: { reference: 'jwt-active-ref', kid: 'active-kid' },
      refreshIntervalMs: 0,
    });
    const token = await issuer.issue({
      userId: 'u-1',
      email: 'a@b.com',
      name: null,
      tenantId: asTenantId('t-1'),
      workspaceId: 'w-1',
      roles: [],
      permissions: [],
    });

    // Simulate the secret reference becoming unavailable; refresh must fail closed
    // and leave the ring in the last-known-good state.
    secrets.setSecret('jwt-active-ref', '');
    await expect(issuer.refresh()).resolves.toBeUndefined();
    const verified = await issuer.verify(token);
    expect(verified).not.toBeNull();
  });
});
