import { createDecipheriv } from 'node:crypto';
import type { ISecretsProvider } from '@projectx/infrastructure';
import {
  ContactChannelProtector,
  ContactChannelProtectionError,
  parseFingerprintEnvelope,
  parseCiphertextEnvelope,
} from '../services/contact-channel-protector';

// ---------------------------------------------------------------------------
// Deterministic test keys (hex-encoded, 32 bytes each)
// ---------------------------------------------------------------------------
const TEST_HMAC_KEY = 'a'.repeat(64);       // 32 bytes of 0xAA
const TEST_HMAC_KEY_V2 = 'c'.repeat(64);    // alternate HMAC key
const TEST_ENC_KEY = 'b'.repeat(64);         // 32 bytes of 0xBB
const TEST_HMAC_VERSION = 'v1';
const TEST_ENC_VERSION = 'v1';

function fakeSecrets(overrides: Record<string, string | Error> = {}): ISecretsProvider {
  const store: Record<string, string | Error> = {
    'projectx/contact-channel/hmac-key': TEST_HMAC_KEY,
    'projectx/contact-channel/hmac-key-version': TEST_HMAC_VERSION,
    'projectx/contact-channel/encryption-key': TEST_ENC_KEY,
    'projectx/contact-channel/encryption-key-version': TEST_ENC_VERSION,
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

/** Decrypt an e1 ciphertext envelope for test verification. NOT a production API. */
function testDecrypt(
  envelope: string,
  tenantId: string,
  channelType: string,
): string {
  const parsed = parseCiphertextEnvelope(envelope);
  const key = Buffer.from(TEST_ENC_KEY, 'hex');
  const aad = Buffer.from(
    JSON.stringify([
      'projectx.contact-encryption',
      1,
      tenantId,
      channelType,
      parsed.keyVersion,
    ]),
  );
  const decipher = createDecipheriv('aes-256-gcm', key, parsed.iv, { authTagLength: 16 });
  decipher.setAAD(aad);
  decipher.setAuthTag(parsed.authTag);
  const decrypted = Buffer.concat([decipher.update(parsed.encrypted), decipher.final()]);
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

  // 1. same canonical email + same tenant + same HMAC version → identical fingerprint
  it('same canonical email + same tenant → same fingerprint', async () => {
    const a = await protector.protectEmail('t1', 'alice@example.com');
    const b = await protector.protectEmail('t1', 'alice@example.com');
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  // 2. casing/whitespace-equivalent email → identical fingerprint
  it('equivalent casing/whitespace → same fingerprint', async () => {
    const a = await protector.protectEmail('t1', '  Alice@Example.COM  ');
    const b = await protector.protectEmail('t1', 'alice@example.com');
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  // 3. different email → different fingerprint
  it('different email → different fingerprint', async () => {
    const a = await protector.protectEmail('t1', 'alice@example.com');
    const b = await protector.protectEmail('t1', 'bob@example.com');
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  // 4. same email under different tenant → different fingerprint
  it('same email across different tenants → different fingerprint', async () => {
    const a = await protector.protectEmail('tenant-a', 'alice@example.com');
    const b = await protector.protectEmail('tenant-b', 'alice@example.com');
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  // 5. fingerprint contains parseable h1 + HMAC key version metadata
  it('fingerprint envelope is parseable h1 with HMAC key version', async () => {
    const result = await protector.protectEmail('t1', 'alice@example.com');
    const parsed = parseFingerprintEnvelope(result.fingerprint);
    expect(parsed.format).toBe('h1');
    expect(parsed.keyVersion).toBe(TEST_HMAC_VERSION);
    expect(parsed.hmac).toHaveLength(32);
  });

  // 6. changing HMAC key/version → distinct versioned fingerprint
  it('different HMAC key/version produces distinct fingerprint', async () => {
    const p1 = new ContactChannelProtector(fakeSecrets());
    const p2 = new ContactChannelProtector(fakeSecrets({
      'projectx/contact-channel/hmac-key': TEST_HMAC_KEY_V2,
      'projectx/contact-channel/hmac-key-version': 'v2',
    }));
    const a = await p1.protectEmail('t1', 'alice@example.com');
    const b = await p2.protectEmail('t1', 'alice@example.com');
    expect(a.fingerprint).not.toBe(b.fingerprint);
    const parsedA = parseFingerprintEnvelope(a.fingerprint);
    const parsedB = parseFingerprintEnvelope(b.fingerprint);
    expect(parsedA.keyVersion).toBe('v1');
    expect(parsedB.keyVersion).toBe('v2');
  });

  // 7. same plaintext encrypted twice → different ciphertext
  it('repeated encryption of same plaintext → different ciphertext', async () => {
    const a = await protector.protectEmail('t1', 'alice@example.com');
    const b = await protector.protectEmail('t1', 'alice@example.com');
    expect(a.ciphertext).not.toBe(b.ciphertext);
    // Both decrypt to same canonical value
    expect(testDecrypt(a.ciphertext!, 't1', 'email')).toBe('alice@example.com');
    expect(testDecrypt(b.ciphertext!, 't1', 'email')).toBe('alice@example.com');
  });

  // 8. ciphertext contains parseable e1 + encryption key version metadata
  it('ciphertext envelope is parseable e1 with encryption key version', async () => {
    const result = await protector.protectEmail('t1', 'alice@example.com');
    const parsed = parseCiphertextEnvelope(result.ciphertext!);
    expect(parsed.format).toBe('e1');
    expect(parsed.keyVersion).toBe(TEST_ENC_VERSION);
    expect(parsed.iv).toHaveLength(12);
    expect(parsed.authTag).toHaveLength(16);
    expect(parsed.encrypted.length).toBeGreaterThan(0);
  });

  // 9. HMAC key version and encryption key version can differ
  it('HMAC and encryption key versions are independently addressable', async () => {
    const p = new ContactChannelProtector(fakeSecrets({
      'projectx/contact-channel/hmac-key-version': 'hmac-v3',
      'projectx/contact-channel/encryption-key-version': 'enc-v7',
    }));
    const result = await p.protectEmail('t1', 'alice@example.com');
    const fp = parseFingerprintEnvelope(result.fingerprint);
    const ct = parseCiphertextEnvelope(result.ciphertext!);
    expect(fp.keyVersion).toBe('hmac-v3');
    expect(ct.keyVersion).toBe('enc-v7');
  });

  // 10. plaintext absent from fingerprint
  it('plaintext email is not present in fingerprint', async () => {
    const result = await protector.protectEmail('t1', 'alice@example.com');
    expect(result.fingerprint).not.toContain('alice');
    expect(result.fingerprint).not.toContain('example.com');
  });

  // 11. plaintext absent from ciphertext
  it('plaintext email is not present in ciphertext envelope', async () => {
    const result = await protector.protectEmail('t1', 'secret-user@private.org');
    const json = JSON.stringify(result);
    expect(json).not.toContain('secret-user');
    expect(json).not.toContain('private.org');
  });

  // 12. raw crypto keys absent from both envelopes
  it('raw crypto keys are not present in envelopes', async () => {
    const result = await protector.protectEmail('t1', 'alice@example.com');
    const combined = result.fingerprint + (result.ciphertext ?? '');
    expect(combined).not.toContain(TEST_HMAC_KEY);
    expect(combined).not.toContain(TEST_ENC_KEY);
  });

  // 13. malformed fingerprint envelope → rejected by parser
  it('malformed fingerprint envelope rejected', () => {
    expect(() => parseFingerprintEnvelope('bad')).toThrow(ContactChannelProtectionError);
    expect(() => parseFingerprintEnvelope('h1.v1')).toThrow(ContactChannelProtectionError);
    expect(() => parseFingerprintEnvelope('h1.v1.too.many')).toThrow(ContactChannelProtectionError);
    expect(() => parseFingerprintEnvelope('h1..AAAA')).toThrow(ContactChannelProtectionError);
  });

  // 14. malformed ciphertext envelope → rejected by parser
  it('malformed ciphertext envelope rejected', () => {
    expect(() => parseCiphertextEnvelope('bad')).toThrow(ContactChannelProtectionError);
    expect(() => parseCiphertextEnvelope('e1.v1')).toThrow(ContactChannelProtectionError);
    expect(() => parseCiphertextEnvelope('e1.v1.too.many')).toThrow(ContactChannelProtectionError);
    expect(() => parseCiphertextEnvelope('e1..AAAA')).toThrow(ContactChannelProtectionError);
    // payload too short (< 12 IV + 16 tag + 1 encrypted = 29 bytes)
    expect(() => parseCiphertextEnvelope('e1.v1.AAAA')).toThrow(ContactChannelProtectionError);
  });

  // 15. unsupported h-envelope version → fail closed
  it('unsupported fingerprint format rejected', () => {
    expect(() => parseFingerprintEnvelope('h99.v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toThrow(
      /Unsupported fingerprint envelope format/,
    );
  });

  // 16. unsupported e-envelope version → fail closed
  it('unsupported ciphertext format rejected', () => {
    expect(() => parseCiphertextEnvelope('e99.v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toThrow(
      /Unsupported ciphertext envelope format/,
    );
  });

  // 17. phone fingerprint deterministic
  it('phone E.164 deterministic fingerprint', async () => {
    const a = await protector.protectPhone('t1', '+1 (555) 123-4567');
    const b = await protector.protectPhone('t1', '+15551234567');
    expect(a.fingerprint).toBe(b.fingerprint);
    const parsed = parseFingerprintEnvelope(a.fingerprint);
    expect(parsed.format).toBe('h1');
  });

  // 18. invalid/ambiguous phone fails closed
  it('invalid/ambiguous phone fails closed', async () => {
    await expect(protector.protectPhone('t1', '5551234567')).rejects.toThrow(ContactChannelProtectionError);
    await expect(protector.protectPhone('t1', '+12345')).rejects.toThrow(ContactChannelProtectionError);
    await expect(protector.protectPhone('t1', '+1555CALLME')).rejects.toThrow(ContactChannelProtectionError);
  });

  // 19. missing HMAC secret/version fails closed
  it('missing HMAC secret or version fails closed', async () => {
    const noKey = new ContactChannelProtector(
      fakeSecrets({ 'projectx/contact-channel/hmac-key': new Error('unavailable') }),
    );
    await expect(noKey.protectEmail('t1', 'a@b.com')).rejects.toThrow(ContactChannelProtectionError);

    const noVer = new ContactChannelProtector(
      fakeSecrets({ 'projectx/contact-channel/hmac-key-version': new Error('unavailable') }),
    );
    await expect(noVer.protectEmail('t1', 'a@b.com')).rejects.toThrow(ContactChannelProtectionError);
  });

  // 20. missing encryption secret/version fails closed
  it('missing encryption secret or version fails closed', async () => {
    const noKey = new ContactChannelProtector(
      fakeSecrets({ 'projectx/contact-channel/encryption-key': new Error('unavailable') }),
    );
    await expect(noKey.protectEmail('t1', 'a@b.com')).rejects.toThrow(ContactChannelProtectionError);

    const noVer = new ContactChannelProtector(
      fakeSecrets({ 'projectx/contact-channel/encryption-key-version': new Error('unavailable') }),
    );
    await expect(noVer.protectEmail('t1', 'a@b.com')).rejects.toThrow(ContactChannelProtectionError);
  });
});
