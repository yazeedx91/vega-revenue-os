import type { ISecretsProvider } from '@projectx/infrastructure';
import {
  buildFingerprintEnvelope,
  canonicalizeEmail,
  decryptCiphertextEnvelope,
  parseCiphertextEnvelope,
} from './contact-channel-protector';
import { RecipientEncryptionKeyResolver, RecipientHmacKeyResolver, validateProtectedKeyVersion } from './protected-channel-keyring';

export interface IOutboundRecipientRecovery {
  recoverEmailForSend(tenantId: string, recipientCiphertext: string): Promise<string>;
}

export interface IHistoricalRecipientFingerprint {
  fingerprintEmailForVersion(tenantId: string, rawEmail: string, keyVersion: string): Promise<string>;
}

export class OutboundRecipientRecovery implements IOutboundRecipientRecovery {
  private readonly encryptionKeys: RecipientEncryptionKeyResolver;

  constructor(secretsProvider: ISecretsProvider) {
    this.encryptionKeys = new RecipientEncryptionKeyResolver(secretsProvider);
  }

  async recoverEmailForSend(tenantId: string, recipientCiphertext: string): Promise<string> {
    const parsed = parseCiphertextEnvelope(recipientCiphertext);
    const key = Buffer.from(await this.encryptionKeys.resolveVersion(parsed.keyVersion));
    return canonicalizeEmail(decryptCiphertextEnvelope(key, tenantId, 'email', recipientCiphertext));
  }
}

export class HistoricalRecipientFingerprint implements IHistoricalRecipientFingerprint {
  private readonly hmacKeys: RecipientHmacKeyResolver;

  constructor(secretsProvider: ISecretsProvider) {
    this.hmacKeys = new RecipientHmacKeyResolver(secretsProvider);
  }

  async fingerprintEmailForVersion(tenantId: string, rawEmail: string, keyVersion: string): Promise<string> {
    const parsedVersion = validateProtectedKeyVersion(keyVersion);
    const key = Buffer.from(await this.hmacKeys.resolveVersion(parsedVersion));
    return buildFingerprintEnvelope(key, parsedVersion, tenantId, 'email', canonicalizeEmail(rawEmail));
  }
}
