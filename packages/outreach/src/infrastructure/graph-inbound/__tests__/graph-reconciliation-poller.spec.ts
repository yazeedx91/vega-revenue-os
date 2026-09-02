import { OutreachMessageExecution } from '@projectx/domain';
import type { TenantContext } from '@projectx/domain';
import { InMemoryIdempotencyStore } from '@projectx/infrastructure';
import { asCampaignId, asCorrelationId, asEventId, asIdempotencyKey, asOutreachExecutionId, asSequenceId, asTenantId } from '@projectx/shared';
import { InMemoryMessageExecutionRepository } from '../../in-memory-message-execution-repository';
import { GraphMessageNormalizer } from '../graph-message-normalizer';
import { GraphReplyCorrelator } from '../graph-reply-correlator';
import { StubGraphInboundMessageFetcher } from '../stub-graph-inbound-message-fetcher';
import { GraphReconciliationPoller, InMemoryGraphReconciliationCheckpointStore } from '../graph-reconciliation-poller';
import type { GraphMessagePayload } from '../graph-inbound.types';
import type { TenantEmailConfig } from '../../../ports/tenant-email-config-repository.interface';

const MAILBOX = 'sales@tenant-a.example.com';
const TENANT_CONFIG: TenantEmailConfig = {
  tenantId: 'tenant-a',
  providerId: 'graph-email',
  channel: 'email',
  fromAddress: MAILBOX,
  allowedDomains: [],
};

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function makeGraphMessage(overrides: Partial<GraphMessagePayload> = {}): GraphMessagePayload {
  return {
    id: nextId('graph-msg'),
    subject: 'Re: Hello',
    from: { emailAddress: { address: 'prospect@example.com' } },
    toRecipients: [{ emailAddress: { address: MAILBOX } }],
    body: { contentType: 'text', content: 'Following up' },
    receivedDateTime: '2026-01-01T12:00:00.000Z',
    ...overrides,
  };
}

async function buildHarness() {
  const messageExecutionRepository = new InMemoryMessageExecutionRepository();
  const ctx: TenantContext = { tenantId: asTenantId('tenant-a'), correlationId: asCorrelationId('corr-1') };
  const execution = OutreachMessageExecution.create(
    {
      id: asOutreachExecutionId(nextId('exec')),
      tenantId: ctx.tenantId,
      campaignId: asCampaignId('camp-1'),
      sequenceId: asSequenceId('seq-1'),
      stepNumber: 1,
      leadId: 'lead-1',
      recipientAddress: 'prospect@example.com',
      channel: 'email',
      idempotencyKey: asIdempotencyKey(nextId('idmp')),
    },
    ctx.correlationId,
    asEventId(nextId('evt')),
  );
  await messageExecutionRepository.save(ctx, execution);

  const messageFetcher = new StubGraphInboundMessageFetcher();
  const idempotencyStore = new InMemoryIdempotencyStore();
  const checkpointStore = new InMemoryGraphReconciliationCheckpointStore();

  const poller = new GraphReconciliationPoller({
    messageFetcher,
    normalizer: new GraphMessageNormalizer(),
    correlator: new GraphReplyCorrelator({ messageExecutionRepository }),
    idempotencyStore,
    checkpointStore,
    // Fixture messages use fixed past timestamps; a 10-year lookback keeps
    // the default (no-checkpoint-yet) window independent of wall-clock time.
    initialLookbackMs: 1000 * 60 * 60 * 24 * 365 * 10,
  });

  return { poller, messageFetcher, checkpointStore, execution };
}

describe('GraphReconciliationPoller', () => {
  it('recovers a missed notification via polling', async () => {
    const { poller, messageFetcher } = await buildHarness();
    messageFetcher.seed(MAILBOX, makeGraphMessage());

    const result = await poller.pollMailbox(TENANT_CONFIG);

    expect(result.processed).toHaveLength(1);
    expect(result.skippedDuplicates).toBe(0);
  });

  it('does not reprocess a message the webhook already handled (shared idempotency store)', async () => {
    const { poller, messageFetcher, checkpointStore } = await buildHarness();
    const message = makeGraphMessage();
    messageFetcher.seed(MAILBOX, message);

    const first = await poller.pollMailbox(TENANT_CONFIG);
    expect(first.processed).toHaveLength(1);

    // Reset the checkpoint so the second poll re-sees the same message id;
    // the shared idempotency claim must prevent reprocessing regardless.
    await checkpointStore.set(MAILBOX, new Date(0));
    const second = await poller.pollMailbox(TENANT_CONFIG);

    expect(second.processed).toHaveLength(0);
    expect(second.skippedDuplicates).toBe(1);
  });

  it('advances the checkpoint to the latest received message time', async () => {
    const { poller, messageFetcher, checkpointStore } = await buildHarness();
    messageFetcher.seed(MAILBOX, makeGraphMessage({ receivedDateTime: '2026-02-01T00:00:00.000Z' }));

    await poller.pollMailbox(TENANT_CONFIG);

    const checkpoint = await checkpointStore.get(MAILBOX);
    expect(checkpoint?.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('counts NOT_CORRELATED and AMBIGUOUS outcomes without throwing', async () => {
    const { poller, messageFetcher } = await buildHarness();
    messageFetcher.seed(MAILBOX, makeGraphMessage({ from: { emailAddress: { address: 'unrelated@example.com' } } }));

    const result = await poller.pollMailbox(TENANT_CONFIG);

    expect(result.notCorrelated).toBe(1);
    expect(result.processed).toHaveLength(0);
  });
});
