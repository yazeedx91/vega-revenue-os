import type { ISecretsProvider } from '@projectx/infrastructure';
import { GraphWebhookValidator } from '../graph-webhook-validator';
import type { GraphChangeNotification } from '../graph-inbound.types';

class FakeSecretsProvider implements ISecretsProvider {
  constructor(private readonly secrets: Record<string, string> = {}) {}
  async getSecret(name: string): Promise<string> {
    const value = this.secrets[name];
    if (!value) throw new Error(`Secret not found: ${name}`);
    return value;
  }
  async getCertificate(): Promise<Buffer> {
    throw new Error('not implemented');
  }
}

function makeNotification(overrides: Partial<GraphChangeNotification> = {}): GraphChangeNotification {
  return {
    subscriptionId: 'sub-1',
    changeType: 'created',
    resource: 'Users/sales@tenant-a.example.com/Messages/msg-1',
    clientState: 'correct-secret',
    resourceData: { id: 'msg-1' },
    ...overrides,
  };
}

describe('GraphWebhookValidator', () => {
  describe('validateShape', () => {
    it('accepts a well-formed notification', () => {
      const validator = new GraphWebhookValidator({ secretsProvider: new FakeSecretsProvider() });
      expect(validator.validateShape(makeNotification())).toEqual({ status: 'VALID' });
    });

    it('rejects a non-object payload', () => {
      const validator = new GraphWebhookValidator({ secretsProvider: new FakeSecretsProvider() });
      const result = validator.validateShape('not-an-object');
      expect(result.status).toBe('MALFORMED');
    });

    it('rejects a payload missing subscriptionId', () => {
      const validator = new GraphWebhookValidator({ secretsProvider: new FakeSecretsProvider() });
      const result = validator.validateShape({ ...makeNotification(), subscriptionId: undefined });
      expect(result.status).toBe('MALFORMED');
    });

    it('rejects a payload missing resource', () => {
      const validator = new GraphWebhookValidator({ secretsProvider: new FakeSecretsProvider() });
      const result = validator.validateShape({ ...makeNotification(), resource: undefined });
      expect(result.status).toBe('MALFORMED');
    });

    it('rejects a payload missing changeType', () => {
      const validator = new GraphWebhookValidator({ secretsProvider: new FakeSecretsProvider() });
      const result = validator.validateShape({ ...makeNotification(), changeType: undefined });
      expect(result.status).toBe('MALFORMED');
    });

    it('rejects an oversized notification', () => {
      const validator = new GraphWebhookValidator({ secretsProvider: new FakeSecretsProvider(), maxNotificationBytes: 50 });
      const result = validator.validateShape(makeNotification({ resource: 'x'.repeat(200) }));
      expect(result.status).toBe('OVERSIZED');
    });
  });

  describe('validateClientState', () => {
    it('accepts a matching clientState', async () => {
      const validator = new GraphWebhookValidator({ secretsProvider: new FakeSecretsProvider({ 'tenant-a-webhook-secret': 'correct-secret' }) });
      const result = await validator.validateClientState(makeNotification(), 'tenant-a-webhook-secret');
      expect(result).toEqual({ status: 'VALID' });
    });

    it('rejects a mismatched clientState', async () => {
      const validator = new GraphWebhookValidator({ secretsProvider: new FakeSecretsProvider({ 'tenant-a-webhook-secret': 'correct-secret' }) });
      const result = await validator.validateClientState(makeNotification({ clientState: 'forged' }), 'tenant-a-webhook-secret');
      expect(result.status).toBe('INVALID_CLIENT_STATE');
    });

    it('rejects a missing clientState', async () => {
      const validator = new GraphWebhookValidator({ secretsProvider: new FakeSecretsProvider({ 'tenant-a-webhook-secret': 'correct-secret' }) });
      const result = await validator.validateClientState(makeNotification({ clientState: undefined }), 'tenant-a-webhook-secret');
      expect(result.status).toBe('INVALID_CLIENT_STATE');
    });

    it('rejects when the tenant has no webhook secret configured', async () => {
      const validator = new GraphWebhookValidator({ secretsProvider: new FakeSecretsProvider() });
      const result = await validator.validateClientState(makeNotification(), undefined);
      expect(result.status).toBe('INVALID_CLIENT_STATE');
    });

    it('rejects a wrong-length clientState without comparing values', async () => {
      const validator = new GraphWebhookValidator({ secretsProvider: new FakeSecretsProvider({ 'tenant-a-webhook-secret': 'correct-secret' }) });
      const result = await validator.validateClientState(makeNotification({ clientState: 'x' }), 'tenant-a-webhook-secret');
      expect(result.status).toBe('INVALID_CLIENT_STATE');
    });

    it('rejects an incorrect clientState and never leaks the supplied or expected secret', async () => {
      const expected = 'actual-registered-secret';
      const supplied = 'P0_2_SENTINEL_SECRET_DO_NOT_LEAK';
      const validator = new GraphWebhookValidator({ secretsProvider: new FakeSecretsProvider({ 'tenant-a-webhook-secret': expected }) });
      const result = await validator.validateClientState(makeNotification({ clientState: supplied }), 'tenant-a-webhook-secret');

      expect(result.status).toBe('INVALID_CLIENT_STATE');
      expect(result.reason).not.toContain(expected);
      expect(result.reason).not.toContain(supplied);
      expect(result.reason).not.toContain('P0_2_SENTINEL');
    });
  });
});
