import { createHmac, createCipheriv, randomBytes } from 'node:crypto';
import type { ISecretsProvider } from '@projectx/infrastructure';
import type { IContactChannelProtector, ProtectedContactChannel } from './contact-channel-protector.interface';

const HMAC_SECRET_NAME = 'projectx/contact-channel/hmac-key';
const ENCRYPTION_SECRET_NAME = 'projectx/contact-channel/encryption-key';
const KEY_VERSION_SECRET_NAME = 'projectx/contact-channel/key-version';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export class ContactChannelProtectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContactChannelProtectionError';
  }
}

export class ContactChannelProtector implements IContactChannelProtector {
  constructor(private readonly secrets: ISecretsProvider) {}

  async protectEmail(tenantId: string, rawEmail: string): Promise<ProtectedContactChannel> {
    const canonical = canonicalizeEmail(rawEmail);
    return this.protect(tenantId, 'email', canonical);
  }

  async protectPhone(tenantId: string, rawPhone: string): Promise<ProtectedContactChannel> {
    const canonical = canonicalizePhone(rawPhone);
    return this.protect(tenantId, 'phone', canonical);
  }

  private async protect(
    tenantId: string,
    channelType: string,
    canonicalValue: string,
  ): Promise<ProtectedContactChannel> {
    const [hmacKeyHex, encKeyHex, keyVersion] = await this.loadKeys();

    const hmacKey = parseHexKey(hmacKeyHex, 32, 'HMAC');
    const encKey = parseHexKey(encKeyHex, 32, 'encryption');

    const fingerprint = computeFingerprint(hmacKey, tenantId, channelType, canonicalValue);
    const ciphertext = encrypt(encKey, tenantId, channelType, keyVersion, canonicalValue);

    return { fingerprint, ciphertext, keyVersion };
  }

  private async loadKeys(): Promise<[string, string, string]> {
    let hmacKeyHex: string;
    let encKeyHex: string;
    let keyVersion: string;

    try {
      hmacKeyHex = await this.secrets.getSecret(HMAC_SECRET_NAME);
    } catch {
      throw new ContactChannelProtectionError('HMAC secret unavailable');
    }
    try {
      encKeyHex = await this.secrets.getSecret(ENCRYPTION_SECRET_NAME);
    } catch {
      throw new ContactChannelProtectionError('Encryption secret unavailable');
    }
    try {
      keyVersion = await this.secrets.getSecret(KEY_VERSION_SECRET_NAME);
    } catch {
      throw new ContactChannelProtectionError('Key version secret unavailable');
    }

    return [hmacKeyHex, encKeyHex, keyVersion];
  }
}

// ---------------------------------------------------------------------------
// Canonicalization
// ---------------------------------------------------------------------------

function canonicalizeEmail(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    throw new ContactChannelProtectionError('Email is empty');
  }
  const atIndex = trimmed.indexOf('@');
  if (atIndex < 1 || atIndex === trimmed.length - 1) {
    throw new ContactChannelProtectionError('Email is malformed');
  }
  return trimmed;
}

function canonicalizePhone(raw: string): string {
  const stripped = raw.replace(/[\s\-().]/g, '');
  if (!stripped.startsWith('+')) {
    throw new ContactChannelProtectionError(
      'Phone number must include international prefix (e.g. +1...)',
    );
  }
  const digits = stripped.slice(1);
  if (!/^\d+$/.test(digits)) {
    throw new ContactChannelProtectionError('Phone number contains non-digit characters');
  }
  if (digits.length < 7) {
    throw new ContactChannelProtectionError(
      'Phone number too short for E.164 (minimum 7 digits after +)',
    );
  }
  if (digits.length > 15) {
    throw new ContactChannelProtectionError(
      'Phone number too long for E.164 (maximum 15 digits after +)',
    );
  }
  return `+${digits}`;
}

// ---------------------------------------------------------------------------
// Key parsing
// ---------------------------------------------------------------------------

function parseHexKey(hex: string, expectedBytes: number, label: string): Buffer {
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new ContactChannelProtectionError(`${label} key is not valid hex`);
  }
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== expectedBytes) {
    throw new ContactChannelProtectionError(
      `${label} key must be ${expectedBytes} bytes (got ${buf.length})`,
    );
  }
  return buf;
}

// ---------------------------------------------------------------------------
// HMAC fingerprint
// ---------------------------------------------------------------------------

function computeFingerprint(
  key: Buffer,
  tenantId: string,
  channelType: string,
  canonicalValue: string,
): string {
  const input = `${tenantId}:${channelType}:${canonicalValue}`;
  return createHmac('sha256', key).update(input).digest('hex');
}

// ---------------------------------------------------------------------------
// AES-256-GCM encryption
// ---------------------------------------------------------------------------

function encrypt(
  key: Buffer,
  tenantId: string,
  channelType: string,
  keyVersion: string,
  plaintext: string,
): string {
  const iv = randomBytes(IV_LENGTH);
  const aad = Buffer.from(`${tenantId}:${channelType}:${keyVersion}`);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Pack: IV (12) || authTag (16) || ciphertext
  const packed = Buffer.concat([iv, tag, encrypted]);
  return packed.toString('base64');
}
