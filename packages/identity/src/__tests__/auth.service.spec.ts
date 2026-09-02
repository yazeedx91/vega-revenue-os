import { AuthService } from '../application/auth.service';
import { HmacTokenIssuer } from '../infrastructure/hmac-token-issuer';
import { FakeOidcProvider } from '../infrastructure/fake-oidc-provider';
import { asTenantId } from '@projectx/shared';
import { FakeIdentityRepository } from './fake-identity-repository';
import { FakeSecretsProvider } from './fake-secrets-provider';

class FakeAuditLog {
  records: unknown[] = [];
  async record(_ctx: unknown, entry: unknown): Promise<void> {
    this.records.push(entry);
  }
}

class FakeTelemetry {
  metrics: unknown[] = [];
  increment(name: string, value?: number, tags?: Record<string, string>) {
    this.metrics.push({ name, value, tags });
  }
  span<T>(_: string, operation: () => Promise<T>): Promise<T> {
    return operation();
  }
  histogram(_: string, _v: number, _tags?: Record<string, string>) {}
  log(_: 'debug' | 'info' | 'warn' | 'error', _m: string, _meta?: Record<string, unknown>) {}
}

function base64Key() {
  return Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString('base64url');
}

const testKey = base64Key();

describe('AuthService', () => {
  let issuer: HmacTokenIssuer;
  const repository = new FakeIdentityRepository();
  const audit = new FakeAuditLog();
  const telemetry = new FakeTelemetry();

  beforeAll(async () => {
    issuer = await HmacTokenIssuer.create({
      secrets: new FakeSecretsProvider({ 'jwt-active-ref': testKey }),
      active: { reference: 'jwt-active-ref', kid: 'active-kid' },
      issuer: 'test',
      audience: 'test',
      refreshIntervalMs: 0,
    });
  });

  beforeEach(() => {
    repository['users'].clear();
    repository['emails'].clear();
    repository['workspaces'].clear();
    repository['memberships'].clear();
    audit.records = [];
    telemetry.metrics = [];
  });

  it('creates a new user and workspace on first Entra-style login', async () => {
    const service = new AuthService({
      identityProvider: new FakeOidcProvider({
        email: 'new@example.com',
        name: 'New User',
        userId: 'u-new',
        tenantId: 't-new',
        workspaceId: '',
        roles: [],
        permissions: [],
      }),
      tokenIssuer: issuer,
      repository,
      audit: audit as unknown as import('@projectx/infrastructure').IAuditLog,
      telemetry: telemetry as unknown as import('@projectx/infrastructure').ITelemetry,
    });

    const result = await service.authenticate('any-token');
    expect(result).not.toBeNull();
    expect(result?.user.email).toBe('new@example.com');
    expect(result?.workspace.ownerUserId).toBe('u-new');
    expect(audit.records.length).toBeGreaterThan(0);
  });

  it('rejects an invalid OIDC token', async () => {
    const failingProvider = {
      validateToken: async () => null,
      describe: () => ({ issuer: 'none', type: 'Null' }),
    };
    const service = new AuthService({
      identityProvider: failingProvider as unknown as import('../ports/identity-provider.interface').IdentityProvider,
      tokenIssuer: issuer,
      repository,
      audit: audit as unknown as import('@projectx/infrastructure').IAuditLog,
      telemetry: telemetry as unknown as import('@projectx/infrastructure').ITelemetry,
    });
    const result = await service.authenticate('bad');
    expect(result).toBeNull();
    expect(audit.records.some((r: unknown) => (r as { result: string }).result === 'denied')).toBe(true);
  });

  it('verifies an issued token and returns the user', async () => {
    const service = new AuthService({
      identityProvider: new FakeOidcProvider({
        email: 'me@example.com',
        name: 'Me',
        userId: 'u-me',
        tenantId: 'u-me',
        workspaceId: 'ws-1',
        roles: ['OWNER'],
        permissions: ['workspace:manage'],
      }),
      tokenIssuer: issuer,
      repository,
      audit: audit as unknown as import('@projectx/infrastructure').IAuditLog,
      telemetry: telemetry as unknown as import('@projectx/infrastructure').ITelemetry,
    });
    await repository.upsertUser({ id: 'u-me', email: 'me@example.com', name: 'Me' });
    await repository.createWorkspace('Mine', 'u-me');

    const auth = await service.authenticate('token');
    const me = await service.me(auth!.accessToken);
    expect(me?.userId).toBe('u-me');
    expect(me?.workspaceId).toBe(auth!.workspace.id);
    expect(me?.tenantId).toBe(asTenantId('u-me'));
  });
});
