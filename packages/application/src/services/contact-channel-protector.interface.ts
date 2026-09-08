export interface ProtectedContactChannel {
  readonly fingerprint: string;
  readonly ciphertext?: string;
  readonly keyVersion?: string;
}

export interface IContactChannelProtector {
  protectEmail(tenantId: string, rawEmail: string): Promise<ProtectedContactChannel>;
  protectPhone(tenantId: string, rawPhone: string): Promise<ProtectedContactChannel>;
}
