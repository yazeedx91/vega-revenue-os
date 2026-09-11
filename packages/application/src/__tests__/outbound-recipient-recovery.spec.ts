import type { ISecretsProvider } from '@projectx/infrastructure';
import { ContactChannelProtector } from '../services/contact-channel-protector';
import { HistoricalRecipientFingerprint, OutboundRecipientRecovery } from '../services/outbound-recipient-recovery';
import { RecipientEncryptionKeyResolver } from '../services/protected-channel-keyring';

class Secrets implements ISecretsProvider {
  readonly reads: string[] = [];
  constructor(private readonly values: Record<string,string>) {}
  async getSecret(name:string):Promise<string>{this.reads.push(name);if(!(name in this.values))throw new Error('missing');return this.values[name];}
}

const enc1='a'.repeat(64), enc2='b'.repeat(64), hmac1='c'.repeat(64), hmac2='d'.repeat(64);
function values(current='v1'){return {
  'projectx/contact-channel/encryption-key-version':current,
  'projectx/contact-channel/hmac-key-version':current,
  'projectx/contact-channel/encryption-keys/v1':enc1,
  'projectx/contact-channel/encryption-keys/v2':enc2,
  'projectx/contact-channel/hmac-keys/v1':hmac1,
  'projectx/contact-channel/hmac-keys/v2':hmac2,
};}

describe('rotation-aware outbound recipient recovery',()=>{
  it('recovers v1 after current rotates to v2 and new protection uses v2',async()=>{
    const v1=new ContactChannelProtector(new Secrets(values('v1')));
    const protectedV1=await v1.protectEmail('tenant-a',' User@Example.com ');
    const rotated=new Secrets(values('v2'));
    const recovery=new OutboundRecipientRecovery(rotated);
    await expect(recovery.recoverEmailForSend('tenant-a',protectedV1.ciphertext!)).resolves.toBe('user@example.com');
    const protectedV2=await new ContactChannelProtector(rotated).protectEmail('tenant-a','user@example.com');
    expect(protectedV2.ciphertext).toMatch(/^e1\.v2\./);
  });

  it('fails closed for missing historical key and wrong tenant',async()=>{
    const protectedV1=await new ContactChannelProtector(new Secrets(values('v1'))).protectEmail('tenant-a','user@example.com');
    const missing={...values('v2')}; delete (missing as any)['projectx/contact-channel/encryption-keys/v1'];
    await expect(new OutboundRecipientRecovery(new Secrets(missing)).recoverEmailForSend('tenant-a',protectedV1.ciphertext!)).rejects.toThrow();
    await expect(new OutboundRecipientRecovery(new Secrets(values('v2'))).recoverEmailForSend('tenant-b',protectedV1.ciphertext!)).rejects.toThrow();
  });

  it('rejects path-like versions before secret lookup',async()=>{
    const secrets=new Secrets(values());
    await expect(new RecipientEncryptionKeyResolver(secrets).resolveVersion('../v1')).rejects.toThrow('Invalid protected-channel key version');
    expect(secrets.reads).toHaveLength(0);
  });

  it('computes retained historical HMAC fingerprints after rotation',async()=>{
    const secrets=new Secrets(values('v2'));
    const historical=new HistoricalRecipientFingerprint(secrets);
    const a=await historical.fingerprintEmailForVersion('tenant-a',' User@Example.com ','v1');
    const b=await historical.fingerprintEmailForVersion('tenant-a','user@example.com','v1');
    const other=await historical.fingerprintEmailForVersion('tenant-b','user@example.com','v1');
    expect(a).toBe(b);
    expect(a).not.toBe(other);
    expect(a).toMatch(/^h1\.v1\./);
  });
});
