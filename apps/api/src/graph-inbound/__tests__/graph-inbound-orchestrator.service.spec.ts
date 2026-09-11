import { InMemoryAuditLog, InMemoryIdempotencyStore } from '@projectx/infrastructure';
import {
  ConversationHandlingService,
  DeterministicIntentClassifier,
  InMemoryConversationRepository,
  InMemoryLeadRepository,
  InMemoryNextBestActionPolicy,
  NoOpPIIScrubber,
} from '@projectx/conversation';
import { OutreachMessageExecution } from '@projectx/domain';
import type { TenantContext } from '@projectx/domain';
import {
  FakeTemporalSignalDispatcher,
  GraphInboundIngressService,
  GraphMessageNormalizer,
  GraphReplyCorrelator,
  GraphTenantResolver,
  GraphWebhookValidator,
  InMemoryGraphSubscriptionRepository,
  InMemoryMessageExecutionRepository,
  InMemorySuppressionRepository,
  InMemoryTenantEmailConfigRepository,
  StubGraphInboundMessageFetcher,
} from '@projectx/outreach';
import type { ISecretsProvider } from '@projectx/infrastructure';
import { asCampaignId, asCorrelationId, asEventId, asIdempotencyKey, asOutreachExecutionId, asSequenceId, asTenantId } from '@projectx/shared';
import { randomUUID } from 'crypto';
import { GraphInboundOrchestratorService } from '../graph-inbound-orchestrator.service';
import type { GraphChangeNotification, GraphMessagePayload } from '@projectx/outreach';

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
const CLIENT_STATE = 'correct-secret';

function makeNotification(overrides: Partial<GraphChangeNotification> = {}): GraphChangeNotification {
  return {
    subscriptionId: 'sub-1',
    changeType: 'created',
    resource: `Users/${MAILBOX}/Messages/graph-msg-1`,
    clientState: CLIENT_STATE,
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
  const suppressionRepository = new InMemorySuppressionRepository();
  const ctx: TenantContext = { tenantId: asTenantId(TENANT_A), workspaceId: 'workspace-1', correlationId: asCorrelationId('corr-1') };
  const execution = OutreachMessageExecution.create(
    {
      id: asOutreachExecutionId('exec-1'),
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
      idempotencyKey: asIdempotencyKey('idmp-1'),
      providerMessageId: '<msg-1@example.com>',
    },
    ctx.correlationId,
    asEventId('evt-1'),
  );

  const idempotencyStore = new InMemoryIdempotencyStore();

  const subscriptionRepository = new InMemoryGraphSubscriptionRepository();
  await subscriptionRepository.save(ctx, {
    tenantId: TENANT_A,
    subscriptionId: 'sub-1',
    resource: `Users/${MAILBOX}/Messages`,
    notificationUrl: 'https://example.com/webhook',
    clientState: CLIENT_STATE,
    expirationDateTime: new Date(Date.now() + 86400000),
  });

  const messageFetcher = new StubGraphInboundMessageFetcher();

  const ingressService = new GraphInboundIngressService({
    validator: new GraphWebhookValidator({ secretsProvider: new FakeSecretsProvider({ 'tenant-a-webhook-secret-ref': CLIENT_STATE }) }),
    tenantResolver: new GraphTenantResolver(tenantEmailConfigRepository),
    subscriptionRepository,
    messageFetcher,
    normalizer: new GraphMessageNormalizer(),
    correlator: new GraphReplyCorrelator({ messageExecutionRepository }),
    idempotencyStore,
  });

  const conversationService = new ConversationHandlingService({
    conversationRepository: new InMemoryConversationRepository(),
    leadRepository: new InMemoryLeadRepository(),
    intentClassifier: new DeterministicIntentClassifier(),
    nextBestActionPolicy: new InMemoryNextBestActionPolicy(),
    piiScrubber: new NoOpPIIScrubber(),
    generateConversationId: () => randomUUID(),
    generateReplyMessageId: () => randomUUID(),
    generateEventId: () => randomUUID(),
  });

  const signalDispatcher = new FakeTemporalSignalDispatcher();
  const auditLog = new InMemoryAuditLog();

  const orchestrator = new GraphInboundOrchestratorService({
    ingressService,
    conversationService,
    suppressionRepository,
    messageExecutionRepository,
    signalDispatcher,
    auditLog,
  });

  return { orchestrator, messageExecutionRepository, ctx, execution, messageFetcher, suppressionRepository, signalDispatcher, auditLog };
}

async function seedExecution(harness: ReturnType<typeof buildHarness>) {
  await harness.messageExecutionRepository.save(harness.ctx, harness.execution);
}

describe('GraphInboundOrchestratorService', () => {
  it('processes a valid notification end to end and dispatches a Temporal signal', async () => {
    const harness = await buildHarness();
    await seedExecution(harness);
    harness.messageFetcher.seed(MAILBOX, makeGraphMessage());

    const result = await harness.orchestrator.processNotification(makeNotification());

    expect(result.status).toBe('PROCESSED');
    if (result.status !== 'PROCESSED') return;
    expect(result.signalOutcome).toBe('DISPATCHED');
    expect(harness.signalDispatcher.dispatched).toHaveLength(1);
    expect(harness.signalDispatcher.dispatched[0].workflowId).toContain('tenant-a');
    expect(harness.signalDispatcher.dispatched[0].workflowId).toContain('seq-1');
  });

  it('records an audit entry for the ingress outcome', async () => {
    const harness = await buildHarness();
    await seedExecution(harness);
    harness.messageFetcher.seed(MAILBOX, makeGraphMessage());

    await harness.orchestrator.processNotification(makeNotification());

    expect(harness.auditLog.entries.some((e) => e.action === 'graph_inbound_ingress' && e.result === 'success')).toBe(true);
  });

  it('propagates a REJECTED outcome for an invalid clientState without touching conversation state', async () => {
    const harness = await buildHarness();
    await seedExecution(harness);
    harness.messageFetcher.seed(MAILBOX, makeGraphMessage());

    const result = await harness.orchestrator.processNotification(makeNotification({ clientState: 'forged' }));

    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.reasonCode).toBe('INVALID_CLIENT_STATE');
  });

  it('propagates a DUPLICATE outcome on the second delivery of the same notification', async () => {
    const harness = await buildHarness();
    await seedExecution(harness);
    harness.messageFetcher.seed(MAILBOX, makeGraphMessage());
    const notification = makeNotification();

    await harness.orchestrator.processNotification(notification);
    const second = await harness.orchestrator.processNotification(notification);

    expect(second.status).toBe('DUPLICATE');
    expect(harness.signalDispatcher.dispatched).toHaveLength(1);
  });

  it('persists a durable suppression record and skips Temporal signal dispatch when the reply is an opt-out', async () => {
    const harness = await buildHarness();
    await seedExecution(harness);
    harness.messageFetcher.seed(MAILBOX, makeGraphMessage({ body: { contentType: 'text', content: 'please unsubscribe me' } }));

    const result = await harness.orchestrator.processNotification(makeNotification());

    expect(result.status).toBe('OPTED_OUT');
    const suppression = await harness.suppressionRepository.isSuppressed(harness.ctx, 'prospect@example.com');
    expect(suppression).not.toBeNull();
    expect(harness.signalDispatcher.dispatched).toHaveLength(0);
  });

  it('propagates a NOT_CORRELATED outcome without invoking the conversation service', async () => {
    const harness = await buildHarness();
    // No execution seeded — correlator has nothing to match against.
    harness.messageFetcher.seed(MAILBOX, makeGraphMessage());

    const result = await harness.orchestrator.processNotification(makeNotification());

    expect(result.status).toBe('NOT_CORRELATED');
    expect(harness.signalDispatcher.dispatched).toHaveLength(0);
  });
});
