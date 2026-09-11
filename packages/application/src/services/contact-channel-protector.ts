import { createHmac, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { ISecretsProvider } from '@projectx/infrastructure';
import type { IContactChannelProtector, ProtectedContactChannel } from './contact-channel-protector.interface';
import { RecipientEncryptionKeyResolver, RecipientHmacKeyResolver } from './protected-channel-keyring';

// ---------------------------------------------------------------------------
// Secret names (HMAC and encryption independently versioned)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Crypto constants
// ---------------------------------------------------------------------------
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const HMAC_LENGTH = 32;

const FINGERPRINT_FORMAT = 'h1';
const CIPHERTEXT_FORMAT = 'e1';

export class ContactChannelProtectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContactChannelProtectionError';
  }
}

// ---------------------------------------------------------------------------
// Base64url helpers (no padding)
// ---------------------------------------------------------------------------
function toBase64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str: string): Buffer {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------
export class ContactChannelProtector implements IContactChannelProtector {
  private readonly encryptionKeys: RecipientEncryptionKeyResolver;
  private readonly hmacKeys: RecipientHmacKeyResolver;
  constructor(secrets: ISecretsProvider) {
    this.encryptionKeys = new RecipientEncryptionKeyResolver(secrets);
    this.hmacKeys = new RecipientHmacKeyResolver(secrets);
  }

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
    const keys = await this.loadKeys();

    const hmacKey = parseHexKey(keys.hmacKeyHex, 32, 'HMAC');
    const encKey = parseHexKey(keys.encKeyHex, 32, 'encryption');

    const fingerprint = buildFingerprintEnvelope(
      hmacKey, keys.hmacKeyVersion, tenantId, channelType, canonicalValue,
    );
    const ciphertext = buildCiphertextEnvelope(
      encKey, keys.encKeyVersion, tenantId, channelType, canonicalValue,
    );

    return { fingerprint, ciphertext };
  }

  private async loadKeys(): Promise<{
    hmacKeyHex: string;
    hmacKeyVersion: string;
    encKeyHex: string;
    encKeyVersion: string;
  }> {
    try {
      const hmac = await this.hmacKeys.resolveCurrent();
      const encryption = await this.encryptionKeys.resolveCurrent();
      return {
        hmacKeyHex: Buffer.from(hmac.key).toString('hex'),
        hmacKeyVersion: hmac.keyVersion,
        encKeyHex: Buffer.from(encryption.key).toString('hex'),
        encKeyVersion: encryption.keyVersion,
      };
    } catch {
      throw new ContactChannelProtectionError('Protected-channel key material unavailable');
    }
  }
}

// ---------------------------------------------------------------------------
// Canonicalization
// ---------------------------------------------------------------------------

export function canonicalizeEmail(raw: string): string {
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

export function parseHexKey(hex: string, expectedBytes: number, label: string): Buffer {
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
// Structured HMAC framing
// ---------------------------------------------------------------------------

function buildHmacInput(
  tenantId: string,
  channelType: string,
  canonicalValue: string,
): string {
  return JSON.stringify([
    'projectx.contact-fingerprint',
    1,
    tenantId,
    channelType,
    canonicalValue,
  ]);
}

// ---------------------------------------------------------------------------
// Structured AEAD AAD
// ---------------------------------------------------------------------------

export function buildAad(
  tenantId: string,
  channelType: string,
  encKeyVersion: string,
): Buffer {
  return Buffer.from(
    JSON.stringify([
      'projectx.contact-encryption',
      1,
      tenantId,
      channelType,
      encKeyVersion,
    ]),
  );
}

// ---------------------------------------------------------------------------
// Fingerprint envelope: h1.<hmacKeyVersion>.<base64urlHmac>
// ---------------------------------------------------------------------------

export function buildFingerprintEnvelope(
  key: Buffer,
  hmacKeyVersion: string,
  tenantId: string,
  channelType: string,
  canonicalValue: string,
): string {
  const input = buildHmacInput(tenantId, channelType, canonicalValue);
  const hmac = createHmac('sha256', key).update(input).digest();
  return `${FINGERPRINT_FORMAT}.${hmacKeyVersion}.${toBase64Url(hmac)}`;
}

// ---------------------------------------------------------------------------
// Ciphertext envelope: e1.<encKeyVersion>.<base64urlPayload>
//   where payload = IV(12) || authTag(16) || encrypted
// ---------------------------------------------------------------------------

function buildCiphertextEnvelope(
  key: Buffer,
  encKeyVersion: string,
  tenantId: string,
  channelType: string,
  plaintext: string,
): string {
  const iv = randomBytes(IV_LENGTH);
  const aad = buildAad(tenantId, channelType, encKeyVersion);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, tag, encrypted]);
  return `${CIPHERTEXT_FORMAT}.${encKeyVersion}.${toBase64Url(packed)}`;
}

// ---------------------------------------------------------------------------
// Envelope parsers (exported for test/internal use — NOT in package barrel)
// ---------------------------------------------------------------------------

export interface ParsedFingerprintEnvelope {
  format: string;
  keyVersion: string;
  hmac: Buffer;
}

export interface ParsedCiphertextEnvelope {
  format: string;
  keyVersion: string;
  iv: Buffer;
  authTag: Buffer;
  encrypted: Buffer;
}

export function parseFingerprintEnvelope(envelope: string): ParsedFingerprintEnvelope {
  const parts = envelope.split('.');
  if (parts.length !== 3) {
    throw new ContactChannelProtectionError('Malformed fingerprint envelope: expected 3 segments');
  }
  const [format, keyVersion, b64Hmac] = parts;
  if (format !== FINGERPRINT_FORMAT) {
    throw new ContactChannelProtectionError(
      `Unsupported fingerprint envelope format: ${format}`,
    );
  }
  if (!keyVersion) {
    throw new ContactChannelProtectionError('Fingerprint envelope has empty key version');
  }
  let hmac: Buffer;
  try {
    hmac = fromBase64Url(b64Hmac);
  } catch {
    throw new ContactChannelProtectionError('Fingerprint envelope has invalid base64url payload');
  }
  if (hmac.length !== HMAC_LENGTH) {
    throw new ContactChannelProtectionError(
      `Fingerprint HMAC must be ${HMAC_LENGTH} bytes (got ${hmac.length})`,
    );
  }
  return { format, keyVersion, hmac };
}

export function parseCiphertextEnvelope(envelope: string): ParsedCiphertextEnvelope {
  const parts = envelope.split('.');
  if (parts.length !== 3) {
    throw new ContactChannelProtectionError('Malformed ciphertext envelope: expected 3 segments');
  }
  const [format, keyVersion, b64Payload] = parts;
  if (format !== CIPHERTEXT_FORMAT) {
    throw new ContactChannelProtectionError(
      `Unsupported ciphertext envelope format: ${format}`,
    );
  }
  if (!keyVersion) {
    throw new ContactChannelProtectionError('Ciphertext envelope has empty key version');
  }
  let payload: Buffer;
  try {
    payload = fromBase64Url(b64Payload);
  } catch {
    throw new ContactChannelProtectionError('Ciphertext envelope has invalid base64url payload');
  }
  const minLength = IV_LENGTH + AUTH_TAG_LENGTH + 1;
  if (payload.length < minLength) {
    throw new ContactChannelProtectionError(
      `Ciphertext payload too short (minimum ${minLength} bytes, got ${payload.length})`,
    );
  }
  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  return { format, keyVersion, iv, authTag, encrypted };
}

export function decryptCiphertextEnvelope(
  key: Buffer,
  tenantId: string,
  channelType: string,
  envelope: string,
): string {
  const parsed = parseCiphertextEnvelope(envelope);
  const decipher = createDecipheriv(ALGORITHM, key, parsed.iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAAD(buildAad(tenantId, channelType, parsed.keyVersion));
  decipher.setAuthTag(parsed.authTag);
  try {
    return Buffer.concat([decipher.update(parsed.encrypted), decipher.final()]).toString('utf8');
  } catch {
    throw new ContactChannelProtectionError('Protected channel recovery failed');
  }
}
