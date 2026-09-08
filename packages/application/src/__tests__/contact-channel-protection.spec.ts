import { createDecipheriv } from 'node:crypto';
import type { ISecretsProvider } from '@projectx/infrastructure';
import { ContactChannelProtector, ContactChannelProtectionError } from '../services/contact-channel-protector';

// ---------------------------------------------------------------------------
// Deterministic test keys (hex-encoded, 32 bytes each)
// ---------------------------------------------------------------------------
const TEST_HMAC_KEY = 'a'.repeat(64);   // 32 bytes of 0xAA
const TEST_ENC_KEY  = 'b'.repeat(64);   // 32 bytes of 0xBB
const TEST_KEY_VERSION = 'v1';

function fakeSecrets(overrides: Record<string, string | Error> = {}): ISecretsProvider {
  const store: Record<string, string | Error> = {
    'projectx/contact-channel/hmac-key': TEST_HMAC_KEY,
    'projectx/contact-channel/encryption-key': TEST_ENC_KEY,
    'projectx/contact-channel/key-version': TEST_KEY_VERSION,
    ...overrides,
  };
  return {
    async getSecret(name: string): Promise<string> {
      const val = store[name];
      if (val instanceof Error) throw val;
      if (val === undefined) throw new Error(`Secret not found: ${name}`);
      return val;
    },
    async getCertificate(): Promise<Buffer> {
      throw new Error('Not implemented');
    },
  };
}

/** Decrypt ciphertext using the same AES-256-GCM construction as the protector. */
function testDecrypt(
  ciphertext: string,
  tenantId: string,
  channelType: string,
  keyVersion: string,
): string {
  const packed = Buffer.from(ciphertext, 'base64');
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const encrypted = packed.subarray(28);
  const key = Buffer.from(TEST_ENC_KEY, 'hex');
  const aad = Buffer.from(`${tenantId}:${channelType}:${keyVersion}`);
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('ContactChannelProtector', () => {
  let protector: ContactChannelProtector;

  beforeEach(() => {
    protector = new ContactChannelProtector(fakeSecrets());
  });

  // -- EMAIL FINGERPRINT DETERMINISM -------------------------------------

  it('same canonical email + same tenant → same fingerprint', async () => {
    const a = await protector.protectEmail('t1', 'alice@example.com');
    const b = await protector.protectEmail('t1', 'alice@example.com');
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it('equivalent casing/whitespace → same fingerprint', async () => {
    const a = await protector.protectEmail('t1', '  Alice@Example.COM  ');
    const b = await protector.protectEmail('t1', 'alice@example.com');
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it('different email → different fingerprint', async () => {
    const a = await protector.protectEmail('t1', 'alice@example.com');
    const b = await protector.protectEmail('t1', 'bob@example.com');
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it('same email across different tenants → different fingerprint', async () => {
    const a = await protector.protectEmail('tenant-a', 'alice@example.com');
    const b = await protector.protectEmail('tenant-b', 'alice@example.com');
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  // -- PLAINTEXT ABSENCE -------------------------------------------------

  it('plaintext email is not present in fingerprint', async () => {
    const result = await protector.protectEmail('t1', 'alice@example.com');
    expect(result.fingerprint).not.toContain('alice');
    expect(result.fingerprint).not.toContain('example.com');
  });

  it('plaintext email is not present in ciphertext', async () => {
    const result = await protector.protectEmail('t1', 'alice@example.com');
    expect(result.ciphertext).toBeDefined();
    // Base64 decode and check raw bytes
    const raw = Buffer.from(result.ciphertext!, 'base64').toString('utf8');
    expect(raw).not.toContain('alice@example.com');
  });

  it('no raw plaintext in returned protected object', async () => {
    const result = await protector.protectEmail('t1', 'secret-user@private.org');
    const json = JSON.stringify(result);
    expect(json).not.toContain('secret-user');
    expect(json).not.toContain('private.org');
  });

  // -- ENCRYPTION NON-DETERMINISM ----------------------------------------

  it('repeated encryption of same plaintext → different ciphertext', async () => {
    const a = await protector.protectEmail('t1', 'alice@example.com');
    const b = await protector.protectEmail('t1', 'alice@example.com');
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('both ciphertexts decrypt to original canonical value', async () => {
    const a = await protector.protectEmail('t1', '  Alice@Example.COM  ');
    const b = await protector.protectEmail('t1', 'alice@example.com');
    const decA = testDecrypt(a.ciphertext!, 't1', 'email', TEST_KEY_VERSION);
    const decB = testDecrypt(b.ciphertext!, 't1', 'email', TEST_KEY_VERSION);
    expect(decA).toBe('alice@example.com');
    expect(decB).toBe('alice@example.com');
  });

  // -- TENANT CONTEXT BINDING (ENCRYPTION) --------------------------------

  it('wrong tenant cannot decrypt ciphertext (AAD mismatch)', async () => {
    const result = await protector.protectEmail('tenant-a', 'alice@example.com');
    expect(() => {
      testDecrypt(result.ciphertext!, 'tenant-b', 'email', TEST_KEY_VERSION);
    }).toThrow();
  });

  // -- KEY VERSION -------------------------------------------------------

  it('returns key version in protected result', async () => {
    const result = await protector.protectEmail('t1', 'alice@example.com');
    expect(result.keyVersion).toBe(TEST_KEY_VERSION);
  });

  // -- PHONE CANONICALIZATION --------------------------------------------

  it('phone E.164 deterministic fingerprint', async () => {
    const a = await protector.protectPhone('t1', '+1 (555) 123-4567');
    const b = await protector.protectPhone('t1', '+15551234567');
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it('phone ciphertext decrypts to canonical E.164', async () => {
    const result = await protector.protectPhone('t1', '+1 (555) 123-4567');
    const dec = testDecrypt(result.ciphertext!, 't1', 'phone', TEST_KEY_VERSION);
    expect(dec).toBe('+15551234567');
  });

  it('ambiguous phone without + prefix fails closed', async () => {
    await expect(protector.protectPhone('t1', '5551234567')).rejects.toThrow(
      ContactChannelProtectionError,
    );
  });

  it('phone too short fails closed', async () => {
    await expect(protector.protectPhone('t1', '+12345')).rejects.toThrow(
      ContactChannelProtectionError,
    );
  });

  it('phone with letters fails closed', async () => {
    await expect(protector.protectPhone('t1', '+1555CALLME')).rejects.toThrow(
      ContactChannelProtectionError,
    );
  });

  // -- EMAIL VALIDATION --------------------------------------------------

  it('empty email fails closed', async () => {
    await expect(protector.protectEmail('t1', '')).rejects.toThrow(
      ContactChannelProtectionError,
    );
    await expect(protector.protectEmail('t1', '   ')).rejects.toThrow(
      ContactChannelProtectionError,
    );
  });

  it('malformed email fails closed', async () => {
    await expect(protector.protectEmail('t1', 'no-at-sign')).rejects.toThrow(
      ContactChannelProtectionError,
    );
    await expect(protector.protectEmail('t1', '@domain.com')).rejects.toThrow(
      ContactChannelProtectionError,
    );
    await expect(protector.protectEmail('t1', 'user@')).rejects.toThrow(
      ContactChannelProtectionError,
    );
  });

  // -- SECRET UNAVAILABILITY ---------------------------------------------

  it('unavailable HMAC secret fails closed', async () => {
    const p = new ContactChannelProtector(
      fakeSecrets({ 'projectx/contact-channel/hmac-key': new Error('unavailable') }),
    );
    await expect(p.protectEmail('t1', 'a@b.com')).rejects.toThrow(
      ContactChannelProtectionError,
    );
  });

  it('unavailable encryption secret fails closed', async () => {
    const p = new ContactChannelProtector(
      fakeSecrets({ 'projectx/contact-channel/encryption-key': new Error('unavailable') }),
    );
    await expect(p.protectEmail('t1', 'a@b.com')).rejects.toThrow(
      ContactChannelProtectionError,
    );
  });

  it('invalid hex HMAC key fails closed', async () => {
    const p = new ContactChannelProtector(
      fakeSecrets({ 'projectx/contact-channel/hmac-key': 'not-hex!' }),
    );
    await expect(p.protectEmail('t1', 'a@b.com')).rejects.toThrow(
      ContactChannelProtectionError,
    );
  });

  it('wrong-length encryption key fails closed', async () => {
    const p = new ContactChannelProtector(
      fakeSecrets({ 'projectx/contact-channel/encryption-key': 'aabb' }),
    );
    await expect(p.protectEmail('t1', 'a@b.com')).rejects.toThrow(
      ContactChannelProtectionError,
    );
  });
});
