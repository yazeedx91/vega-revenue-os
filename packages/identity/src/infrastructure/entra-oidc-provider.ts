import { createPublicKey, verify } from 'crypto';
import type { IdentityProvider, AuthenticatedUser } from '../ports/identity-provider.interface';
import { asTenantId, type TenantId } from '@projectx/shared';

export interface EntraOidcProviderConfig {
  /** Expected token issuer, e.g. https://login.microsoftonline.com/{tenant}/v2.0 */
  issuer: string;
  /** Expected client (audience) id. */
  clientId: string;
  /** JWK set as JSON array. Can be loaded from jwks_uri or from a secret. */
  jwks: unknown[];
  /** Tenant that callers are authorized for. */
  allowedTenantId: TenantId;
}

interface Jwk {
  kid: string;
  n: string;
  e: string;
  kty: 'RSA';
}

interface IdTokenPayload {
  sub: string;
  email: string;
  name?: string;
  oid?: string;
  tid?: string;
  iss: string;
  aud: string;
  exp: number;
  iat: number;
}

export class EntraOidcProvider implements IdentityProvider {
  constructor(private readonly config: EntraOidcProviderConfig) {}

  async validateToken(token: string): Promise<AuthenticatedUser | null> {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h64, p64, s64] = parts;
    let header: { kid: string } | undefined;
    let payload: IdTokenPayload | undefined;
    try {
      header = JSON.parse(base64UrlDecode(h64)) as { kid: string };
      payload = JSON.parse(base64UrlDecode(p64)) as IdTokenPayload;
    } catch {
      return null;
    }
    if (!header || !payload) return null;

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;
    if (payload.iss !== this.config.issuer) return null;
    if (payload.aud !== this.config.clientId) return null;
    if (payload.tid !== (this.config.allowedTenantId as string)) return null;

    const jwk = this.config.jwks.find((k) => (k as { kid?: string }).kid === header.kid) as Jwk | undefined;
    if (!jwk || jwk.kty !== 'RSA' || !jwk.n || !jwk.e) return null;

    const publicKey = jwkToPublicKey(jwk);
    const signature = Buffer.from(s64, 'base64url');
    const data = Buffer.from(`${h64}.${p64}`);
    const valid = verify('RSA-SHA256', data, publicKey, signature);
    if (!valid) return null;

    // Entra tokens do not carry a workspace claim; the AuthService will resolve
    // the default workspace for the user after this provider returns.
    const userId = payload.oid ?? payload.sub;
    return {
      userId,
      email: payload.email,
      name: payload.name ?? null,
      tenantId: asTenantId(payload.tid as string),
      workspaceId: '',
      roles: [],
      permissions: [],
    };
  }

  describe(): { issuer: string; type: string } {
    return { issuer: this.config.issuer, type: 'EntraOidcProvider' };
  }
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function jwkToPublicKey(jwk: Jwk): import('crypto').KeyObject {
  const key = {
    kty: 'RSA',
    n: jwk.n,
    e: jwk.e,
  } as unknown as import('crypto').JsonWebKey;
  return createPublicKey({ key, format: 'jwk' });
}
