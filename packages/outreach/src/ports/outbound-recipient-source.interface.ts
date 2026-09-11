export interface ResolveProtectedEmailRecipientInput {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly leadId: string;
  readonly contactId: string;
}

export interface ResolvedProtectedEmailRecipient {
  readonly contactId: string;
  readonly recipientFingerprint: string;
  readonly recipientCiphertext: string;
  readonly recipientProtectionState: 'PROTECTED' | 'LEGACY_UNAVAILABLE';
}

export interface IOutboundRecipientSource {
  resolveProtectedEmailRecipient(input: ResolveProtectedEmailRecipientInput): Promise<ResolvedProtectedEmailRecipient>;
}
