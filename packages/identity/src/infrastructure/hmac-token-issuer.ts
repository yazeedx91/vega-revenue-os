import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { AuthenticatedUser } from '../ports/identity-provider.interface';
import type { TokenIssuer } from '../ports/token-issuer.interface';
import type { ISecretsProvider, ITelemetry } from '@projectx/infrastructure';
import { asTenantId } from '@projectx/shared';

export interface HmacTokenIssuerKeySpec {
  kid: string;
  /** Secret reference that will be resolved through ISecretsProvider. */
  reference: string;
}

export interface HmacTokenIssuerConfig {
  secrets: ISecretsProvider;
  active: HmacTokenIssuerKeySpec;
  previous?: HmacTokenIssuerKeySpec & { validUntil: number };
  issuer?: string;
  audience?: string;
  expirySeconds?: number;
  /** How often to refresh the in-memory key ring in milliseconds. Default 60000. */
  refreshIntervalMs?: number;
  /** Maximum staleness before issue() fails closed, in milliseconds. Default 300000 (5 min). */
  maxStalenessMs?: number;
  telemetry?: ITelemetry;
}

interface LoadedKey {
  kid: string;
  key: Buffer;
}

interface KeyRing {
  active: LoadedKey;
  previous: (LoadedKey & { validUntil: number }) | null;
  loadedAt: number;
}

interface TokenHeader {
  alg: string;
  typ: string;
  kid: string;
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

const MIN_KEY_BYTES = 32;
const DEFAULT_REFRESH_INTERVAL_MS = 60_000;
const DEFAULT_MAX_STALENESS_MS = 5 * 60_000;

export class HmacTokenIssuer implements TokenIssuer {
  private readonly algorithm = 'HS256';
  private readonly issuer: string;
  private readonly audience: string;
  private readonly expirySeconds: number;
  private readonly config: HmacTokenIssuerConfig;
  private ring: KeyRing;
  private readonly refreshIntervalMs: number;
  private readonly maxStalenessMs: number;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  private constructor(config: HmacTokenIssuerConfig, ring: KeyRing) {
    this.config = config;
    this.issuer = config.issuer ?? 'projectx';
    this.audience = config.audience ?? 'projectx-api';
    this.expirySeconds = config.expirySeconds ?? 86400;
    this.refreshIntervalMs = config.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
    this.maxStalenessMs = config.maxStalenessMs ?? DEFAULT_MAX_STALENESS_MS;
    this.ring = ring;
  }

  static async create(config: HmacTokenIssuerConfig): Promise<HmacTokenIssuer> {
    const ring = await HmacTokenIssuer.loadRing(config);
    const issuer = new HmacTokenIssuer(config, ring);
    if (issuer.refreshIntervalMs > 0) {
      issuer.refreshTimer = setInterval(() => {
        issuer.refresh().catch(() => {});
      }, issuer.refreshIntervalMs);
      issuer.refreshTimer.unref();
    }
    return issuer;
  }

  /**
   * Manually triggers a key-ring refresh. The new ring is validated fully
   * before the in-memory reference is atomically swapped.
   */
  async refresh(): Promise<void> {
    try {
      const newRing = await HmacTokenIssuer.loadRing(this.config);
      this.ring = newRing;
      this.config.telemetry?.increment('token.issuer.refresh.success', 1);
    } catch (err) {
      this.config.telemetry?.increment('token.issuer.refresh.failed', 1);
      // Never log key material. Log only error category.
      const message = err instanceof Error ? err.message : 'unknown';
      this.config.telemetry?.log('error', 'Token issuer key-ring refresh failed', { reason: message });
    }
  }

  async issue(user: AuthenticatedUser): Promise<string> {
    const nowMs = Date.now();
    const ring = this.ring;
    if (nowMs - ring.loadedAt > this.maxStalenessMs) {
      throw new Error('Token issuer key ring is stale; refusing to issue new token');
    }

    const now = Math.floor(nowMs / 1000);
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

    const header: TokenHeader = { alg: this.algorithm, typ: 'JWT', kid: ring.active.kid };
    const encodedHeader = base64Url(JSON.stringify(header));
    const encodedPayload = base64Url(JSON.stringify(payload));
    const signature = this.sign(`${encodedHeader}.${encodedPayload}`, ring.active.key);
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  async verify(token: string): Promise<AuthenticatedUser | null> {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [encodedHeader, encodedPayload, signature] = parts;

    let header: TokenHeader | undefined;
    try {
      header = JSON.parse(base64UrlDecode(encodedHeader)) as TokenHeader;
    } catch {
      return null;
    }
    if (!header || header.alg !== this.algorithm || header.typ !== 'JWT' || !header.kid) {
      return null;
    }

    const ring = this.ring;
    const candidate = this.resolveKey(header.kid, ring);
    if (!candidate) {
      return null;
    }

    const expected = this.sign(`${encodedHeader}.${encodedPayload}`, candidate.key);
    const signatureBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expected);
    if (signatureBuf.length !== expectedBuf.length) {
      return null;
    }
    if (!timingSafeEqual(signatureBuf, expectedBuf)) {
      return null;
    }

    let payload: TokenPayload | undefined;
    try {
      payload = JSON.parse(base64UrlDecode(encodedPayload)) as TokenPayload;
    } catch {
      return null;
    }
    if (!payload) return null;

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

  private resolveKey(kid: string, ring: KeyRing): LoadedKey | null {
    if (ring.active.kid === kid) {
      return ring.active;
    }
    if (ring.previous && ring.previous.kid === kid && Date.now() < ring.previous.validUntil) {
      return ring.previous;
    }
    return null;
  }

  private sign(input: string, key: Buffer): string {
    return createHmac('sha256', key).update(input).digest('base64url');
  }

  private static async loadRing(config: HmacTokenIssuerConfig): Promise<KeyRing> {
    const activeKey = await HmacTokenIssuer.loadKey(config.secrets, config.active, 'active');
    HmacTokenIssuer.validateKeyStrength(activeKey.key, 'active');

    if (config.previous) {
      if (config.active.kid === config.previous.kid) {
        throw new Error('Active and previous kid must differ');
      }
      const previousKey = await HmacTokenIssuer.loadKey(config.secrets, config.previous, 'previous');
      HmacTokenIssuer.validateKeyStrength(previousKey.key, 'previous');
      return {
        active: activeKey,
        previous: { ...previousKey, validUntil: config.previous.validUntil },
        loadedAt: Date.now(),
      };
    }

    return {
      active: activeKey,
      previous: null,
      loadedAt: Date.now(),
    };
  }

  private static async loadKey(
    secrets: ISecretsProvider,
    spec: HmacTokenIssuerKeySpec,
    label: string,
  ): Promise<LoadedKey> {
    const raw = await secrets.getSecret(spec.reference);
    if (!raw) {
      throw new Error(`${label} key reference ${spec.reference} resolved to empty value`);
    }
    // Attempt base64url decoding first; fall back to utf8 if not enough bytes.
    let keyBytes = Buffer.from(raw, 'base64url');
    if (keyBytes.length < MIN_KEY_BYTES) {
      keyBytes = Buffer.from(raw);
    }
    HmacTokenIssuer.validateKeyStrength(keyBytes, label);
    return { kid: spec.kid, key: keyBytes };
  }

  private static validateKeyStrength(key: Buffer, label: string): void {
    if (key.length < MIN_KEY_BYTES) {
      throw new Error(`${label} key is shorter than ${MIN_KEY_BYTES} bytes`);
    }
  }
}

function base64Url(input: string): string {
  return Buffer.from(input).toString('base64url');
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}
