export interface IOutboundRecipientRecovery {
  recoverEmailForSend(tenantId: string, recipientCiphertext: string): Promise<string>;
}

export interface IHistoricalRecipientFingerprint {
  fingerprintEmailForVersion(tenantId: string, rawEmail: string, keyVersion: string): Promise<string>;
}
