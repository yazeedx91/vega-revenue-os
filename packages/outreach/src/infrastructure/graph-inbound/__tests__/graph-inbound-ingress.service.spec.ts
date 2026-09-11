import { OutreachMessageExecution } from '@projectx/domain';
import type { TenantContext } from '@projectx/domain';
import { InMemoryIdempotencyStore } from '@projectx/infrastructure';
import type { ISecretsProvider } from '@projectx/infrastructure';
import { asCampaignId, asCorrelationId, asEventId, asIdempotencyKey, asOutreachExecutionId, asSequenceId, asTenantId } from '@projectx/shared';
import { InMemoryGraphSubscriptionRepository } from '../../../infrastructure/in-memory-graph-subscription-repository';
import { InMemoryMessageExecutionRepository } from '../../in-memory-message-execution-repository';
import { InMemoryTenantEmailConfigRepository } from '../../in-memory-tenant-email-config-repository';
import { GraphWebhookValidator } from '../graph-webhook-validator';
import { GraphTenantResolver } from '../graph-tenant-resolver';
import { GraphMessageNormalizer } from '../graph-message-normalizer';
import { GraphReplyCorrelator } from '../graph-reply-correlator';
import { StubGraphInboundMessageFetcher } from '../stub-graph-inbound-message-fetcher';
import { GraphInboundIngressService } from '../graph-inbound-ingress.service';
import type { GraphChangeNotification, GraphMessagePayload } from '../graph-inbound.types';

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

const TENANT_A = 'tenant-a';
const MAILBOX = 'sales@tenant-a.example.com';
const WEBHOOK_SECRET = 'tenant-a-webhook-secret';
const CORRECT_CLIENT_STATE = 'correct-secret';

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function makeNotification(overrides: Partial<GraphChangeNotification> = {}): GraphChangeNotification {
  return {
    subscriptionId: 'sub-1',
    changeType: 'created',
    resource: `Users/${MAILBOX}/Messages/graph-msg-1`,
    clientState: CORRECT_CLIENT_STATE,
    resourceData: { id: 'graph-msg-1' },
    ...overrides,
  };
}

function makeGraphMessage(overrides: Partial<GraphMessagePayload> = {}): GraphMessagePayload {
  return {
    id: 'graph-msg-1',
    subject: 'Re: Hello',
    from: { emailAddress: { address: 'prospect@example.com' } },
    toRecipients: [{ emailAddress: { address: MAILBOX } }],
    body: { contentType: 'text', content: 'Sounds great, thanks!' },
    receivedDateTime: '2026-01-01T12:00:00.000Z',
    internetMessageHeaders: [{ name: 'In-Reply-To', value: '<msg-1@example.com>' }],
    ...overrides,
  };
}

async function buildHarness() {
  const tenantEmailConfigRepository = new InMemoryTenantEmailConfigRepository();
  tenantEmailConfigRepository.seed({
    tenantId: TENANT_A,
    providerId: 'graph-email',
    channel: 'email',
    fromAddress: MAILBOX,
    allowedDomains: ['tenant-a.example.com'],
    webhookSecretReference: 'tenant-a-webhook-secret-ref',
  });

  const messageExecutionRepository = new InMemoryMessageExecutionRepository();
  const ctx: TenantContext = { tenantId: asTenantId(TENANT_A), workspaceId: 'workspace-1', correlationId: asCorrelationId('corr-1') };
  const execution = OutreachMessageExecution.create(
    {
      id: asOutreachExecutionId(nextId('exec')),
      tenantId: ctx.tenantId,
      workspaceId: 'workspace-1',
      campaignId: asCampaignId('camp-1'),
      sequenceId: asSequenceId('seq-1'),
      stepNumber: 1,
      leadId: 'lead-1',
      contactId: 'contact-1',
      recipientFingerprint: 'h1.1.prospect',
      recipientCiphertext: 'e1.1.prospect-cipher',
      recipientProtectionState: 'PROTECTED',
      channel: 'email',
      idempotencyKey: asIdempotencyKey(nextId('idmp')),
      providerMessageId: '<msg-1@example.com>',
    },
    ctx.correlationId,
    asEventId(nextId('evt')),
  );
  await messageExecutionRepository.save(ctx, execution);

  const messageFetcher = new StubGraphInboundMessageFetcher();
  messageFetcher.seed(MAILBOX, makeGraphMessage());

  const idempotencyStore = new InMemoryIdempotencyStore();

  const subscriptionRepository = new InMemoryGraphSubscriptionRepository();
  await subscriptionRepository.save(ctx, {
    tenantId: TENANT_A,
    subscriptionId: 'sub-1',
    resource: `Users/${MAILBOX}/Messages`,
    notificationUrl: 'https://example.com/webhook',
    clientState: CORRECT_CLIENT_STATE,
    expirationDateTime: new Date(Date.now() + 86400000),
  });

  const service = new GraphInboundIngressService({
    validator: new GraphWebhookValidator({ secretsProvider: new FakeSecretsProvider({ 'tenant-a-webhook-secret-ref': CORRECT_CLIENT_STATE }) }),
    tenantResolver: new GraphTenantResolver(tenantEmailConfigRepository),
    subscriptionRepository,
    messageFetcher,
    normalizer: new GraphMessageNormalizer(),
    correlator: new GraphReplyCorrelator({ messageExecutionRepository }),
    idempotencyStore,
  });

  return { service, messageFetcher, execution };
}

describe('GraphInboundIngressService', () => {
  it('processes a valid notification end to end', async () => {
    const { service, execution } = await buildHarness();
    const result = await service.ingest(makeNotification());

    expect(result.status).toBe('PROCESSED');
    if (result.status !== 'PROCESSED') return;
    expect(result.event.executionId).toBe(execution.id);
    expect(result.event.content).toContain('Sounds great');
  });

  it('rejects a notification with an invalid clientState', async () => {
    const { service } = await buildHarness();
    const result = await service.ingest(makeNotification({ clientState: 'forged' }));

    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.reasonCode).toBe('INVALID_CLIENT_STATE');
  });

  it('rejects a malformed notification', async () => {
    const { service } = await buildHarness();
    const result = await service.ingest({ ...makeNotification(), resource: undefined as unknown as string });

    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.reasonCode).toBe('MALFORMED');
  });

  it('rejects a cross-tenant subscription mismatch', async () => {
    const { service } = await buildHarness();
    const result = await service.ingest(makeNotification({ subscriptionId: 'sub-tenant-b' }));

    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.reasonCode).toBe('TENANT_SUBSCRIPTION_MISMATCH');
    expect(result.reason).not.toContain('sub-tenant-b');
  });

  it('rejects a cross-tenant notification (unregistered mailbox)', async () => {
    const { service } = await buildHarness();
    const result = await service.ingest(makeNotification({ resource: 'Users/unknown@other.example.com/Messages/graph-msg-1' }));

    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.reasonCode).toBe('TENANT_NOT_FOUND');
  });

  it('treats a duplicate notification as DUPLICATE and does not reprocess it', async () => {
    const { service, messageFetcher } = await buildHarness();
    const notification = makeNotification();

    const first = await service.ingest(notification);
    expect(first.status).toBe('PROCESSED');

    const second = await service.ingest(notification);
    expect(second.status).toBe('DUPLICATE');

    // Only one fetch: fetching + normalizing does not repeat for the duplicate.
    expect(await messageFetcher.getMessage(MAILBOX, 'graph-msg-1')).not.toBeNull();
  });

  it('replaying the exact same notification payload twice only produces one PROCESSED outcome', async () => {
    const { service } = await buildHarness();
    const notification = makeNotification();

    const results = await Promise.all([service.ingest(notification), service.ingest(structuredClone(notification))]);
    const processedCount = results.filter((r) => r.status === 'PROCESSED').length;
    const duplicateCount = results.filter((r) => r.status === 'DUPLICATE').length;

    expect(processedCount).toBe(1);
    expect(duplicateCount).toBe(1);
  });
});
