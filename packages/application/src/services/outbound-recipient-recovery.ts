import {
  buildFingerprintEnvelope,
  canonicalizeEmail,
  decryptCiphertextEnvelope,
  parseCiphertextEnvelope,
} from './contact-channel-protector';
import { validateProtectedKeyVersion, type IRecipientEncryptionKeyResolver, type IRecipientHmacKeyResolver } from './protected-channel-keyring';

export interface IOutboundRecipientRecovery {
  recoverEmailForSend(tenantId: string, recipientCiphertext: string): Promise<string>;
}

export class OutboundRecipientRecovery implements IOutboundRecipientRecovery {
  constructor(private readonly encryptionKeys: IRecipientEncryptionKeyResolver) {}
  async recoverEmailForSend(tenantId: string, recipientCiphertext: string): Promise<string> {
    const parsed = parseCiphertextEnvelope(recipientCiphertext);
    const key = Buffer.from(await this.encryptionKeys.resolveVersion(parsed.keyVersion));
    return canonicalizeEmail(decryptCiphertextEnvelope(key, tenantId, 'email', recipientCiphertext));
  }
}

export class HistoricalRecipientFingerprint {
  constructor(private readonly hmacKeys: IRecipientHmacKeyResolver) {}
  async fingerprintEmailForVersion(tenantId: string, rawEmail: string, keyVersion: string): Promise<string> {
    const parsedVersion = validateProtectedKeyVersion(keyVersion);
    const key = Buffer.from(await this.hmacKeys.resolveVersion(parsedVersion));
    return buildFingerprintEnvelope(key, parsedVersion, tenantId, 'email', canonicalizeEmail(rawEmail));
  }
}
