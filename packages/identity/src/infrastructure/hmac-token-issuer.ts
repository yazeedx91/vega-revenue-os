import { createHmac, timingSafeEqual } from 'crypto';
import { asTenantId, type TenantId } from '@projectx/shared';
import type { AuthenticatedUser } from '../ports/identity-provider.interface';
import type { TokenIssuer } from '../ports/token-issuer.interface';

export interface HmacTokenIssuerConfig {
  secret: string;
  issuer?: string;
  audience?: string;
  expirySeconds?: number;
}

interface TokenPayload {
  sub: string;
  email: string;
  name: string | null;
  tenant: string;
  workspace: string;
  roles: string[];
  permissions: string[];
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

export class HmacTokenIssuer implements TokenIssuer {
  private readonly algorithm = 'HS256';
  private readonly secret: Buffer;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly expirySeconds: number;

  constructor(config: HmacTokenIssuerConfig) {
    this.secret = Buffer.from(config.secret);
    this.issuer = config.issuer ?? 'projectx';
    this.audience = config.audience ?? 'projectx-api';
    this.expirySeconds = config.expirySeconds ?? 86400;
  }

  async issue(user: AuthenticatedUser): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const payload: TokenPayload = {
      sub: user.userId,
      email: user.email,
      name: user.name,
      tenant: user.tenantId as string,
      workspace: user.workspaceId,
      roles: user.roles,
      permissions: user.permissions,
      iat: now,
      exp: now + this.expirySeconds,
      iss: this.issuer,
      aud: this.audience,
    };
    const header = { alg: this.algorithm, typ: 'JWT' };
    const encodedHeader = base64Url(JSON.stringify(header));
    const encodedPayload = base64Url(JSON.stringify(payload));
    const signature = this.sign(`${encodedHeader}.${encodedPayload}`);
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  async verify(token: string): Promise<AuthenticatedUser | null> {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [encodedHeader, encodedPayload, signature] = parts;
    const expected = this.sign(`${encodedHeader}.${encodedPayload}`);
    const signatureBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expected);
    if (signatureBuf.length !== expectedBuf.length) {
      return null;
    }
    if (!timingSafeEqual(signatureBuf, expectedBuf)) {
      return null;
    }
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as TokenPayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now || payload.iss !== this.issuer || payload.aud !== this.audience) {
      return null;
    }
    return {
      userId: payload.sub,
      email: payload.email,
      name: payload.name,
      tenantId: asTenantId(payload.tenant),
      workspaceId: payload.workspace,
      roles: payload.roles,
      permissions: payload.permissions,
    };
  }

  private sign(input: string): string {
    return createHmac('sha256', this.secret).update(input).digest('base64url');
  }
}

function base64Url(input: string): string {
  return Buffer.from(input).toString('base64url');
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}
