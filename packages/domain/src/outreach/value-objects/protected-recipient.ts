export type RecipientProtectionState = 'PROTECTED' | 'LEGACY_UNAVAILABLE';

export interface ProtectedRecipientIdentity {
  readonly contactId: string;
  readonly recipientFingerprint?: string;
  readonly recipientProtectionState: RecipientProtectionState;
}

export interface ProtectedRecipientSnapshot extends ProtectedRecipientIdentity {
  readonly recipientCiphertext?: string;
}

export function assertProtectedRecipient(identity: ProtectedRecipientIdentity): void {
  if (identity.recipientProtectionState === 'PROTECTED' && !identity.recipientFingerprint) {
    throw new Error('Protected recipient fingerprint is required');
  }
  if (identity.recipientProtectionState === 'LEGACY_UNAVAILABLE' && identity.recipientFingerprint) {
    throw new Error('Legacy unavailable recipient cannot contain a fingerprint');
  }
}

export function assertProtectedRecipientSnapshot(snapshot: ProtectedRecipientSnapshot): void {
  assertProtectedRecipient(snapshot);
  if (snapshot.recipientProtectionState === 'PROTECTED' && !snapshot.recipientCiphertext) {
    throw new Error('Protected recipient ciphertext is required');
  }
  if (snapshot.recipientProtectionState === 'LEGACY_UNAVAILABLE' && snapshot.recipientCiphertext) {
    throw new Error('Legacy unavailable recipient cannot contain ciphertext');
  }
}
