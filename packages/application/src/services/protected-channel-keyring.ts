import type { ISecretsProvider } from '@projectx/infrastructure';
class ProtectedKeyResolutionError extends Error {}

function parseResolvedKey(hex: string, label: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new ProtectedKeyResolutionError(`${label} key is invalid`);
  return Buffer.from(hex, 'hex');
}

const VERSION_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ENCRYPTION_VERSION = 'projectx/contact-channel/encryption-key-version';
const ENCRYPTION_ALIAS = 'projectx/contact-channel/encryption-key';
const ENCRYPTION_PREFIX = 'projectx/contact-channel/encryption-keys/';
const HMAC_VERSION = 'projectx/contact-channel/hmac-key-version';
const HMAC_ALIAS = 'projectx/contact-channel/hmac-key';
const HMAC_PREFIX = 'projectx/contact-channel/hmac-keys/';

export function validateProtectedKeyVersion(version: string): string {
  if (!VERSION_PATTERN.test(version)) throw new ProtectedKeyResolutionError('Invalid protected-channel key version');
  return version;
}

abstract class VersionedKeyResolver {
  constructor(
    protected readonly secrets: ISecretsProvider,
    private readonly versionSecret: string,
    private readonly aliasSecret: string,
    private readonly versionedPrefix: string,
    private readonly label: string,
  ) {}

  async resolveCurrent(): Promise<{ keyVersion: string; key: Uint8Array }> {
    const keyVersion = validateProtectedKeyVersion(await this.read(this.versionSecret, `${this.label} key version unavailable`));
    try {
      return { keyVersion, key: await this.resolveVersion(keyVersion) };
    } catch {
      const alias = await this.read(this.aliasSecret, `${this.label} key unavailable`);
      return { keyVersion, key: parseResolvedKey(alias, this.label) };
    }
  }

  async resolveVersion(keyVersion: string): Promise<Uint8Array> {
    const version = validateProtectedKeyVersion(keyVersion);
    const hex = await this.read(`${this.versionedPrefix}${version}`, `${this.label} key version unavailable`);
    return parseResolvedKey(hex, this.label);
  }

  private async read(name: string, message: string): Promise<string> {
    try { return await this.secrets.getSecret(name); } catch { throw new ProtectedKeyResolutionError(message); }
  }
}

export interface IRecipientEncryptionKeyResolver {
  resolveCurrent(): Promise<{ keyVersion: string; key: Uint8Array }>;
  resolveVersion(keyVersion: string): Promise<Uint8Array>;
}

export interface IRecipientHmacKeyResolver {
  resolveCurrent(): Promise<{ keyVersion: string; key: Uint8Array }>;
  resolveVersion(keyVersion: string): Promise<Uint8Array>;
}

export class RecipientEncryptionKeyResolver extends VersionedKeyResolver implements IRecipientEncryptionKeyResolver {
  constructor(secrets: ISecretsProvider) { super(secrets, ENCRYPTION_VERSION, ENCRYPTION_ALIAS, ENCRYPTION_PREFIX, 'encryption'); }
}

export class RecipientHmacKeyResolver extends VersionedKeyResolver implements IRecipientHmacKeyResolver {
  constructor(secrets: ISecretsProvider) { super(secrets, HMAC_VERSION, HMAC_ALIAS, HMAC_PREFIX, 'HMAC'); }
}
