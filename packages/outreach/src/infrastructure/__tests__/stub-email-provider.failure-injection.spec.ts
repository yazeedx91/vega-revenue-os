import { asCampaignId, asCorrelationId, asIdempotencyKey, asOutreachExecutionId, asOutreachMessageId, asSequenceId, asTenantId } from '@projectx/shared';
import type { TenantContext } from '@projectx/domain';
import { StubEmailProvider } from '../stub-email-provider';

const ctx: TenantContext = { tenantId: asTenantId('tenant-1'), correlationId: asCorrelationId('corr-1') };

function makeRequest(overrides?: { idempotencyKey?: string; body?: string }) {
  return {
    tenantId: asTenantId('tenant-1'),
    campaignId: asCampaignId('campaign-1'),
    sequenceId: asSequenceId('sequence-1'),
    executionId: asOutreachExecutionId('execution-1'),
    messageId: asOutreachMessageId('message-1'),
    idempotencyKey: asIdempotencyKey(overrides?.idempotencyKey ?? 'idmp-1'),
    correlationId: asCorrelationId('corr-1'),
    recipientAddress: 'lead@example.com',
    subject: 'Hello',
    body: overrides?.body ?? 'This is a test message.',
    channel: 'email' as const,
  };
}

describe('StubEmailProvider failure injection', () => {
  it('produces a stable providerMessageId for the same logical send', async () => {
    const provider = new StubEmailProvider();
    const request = makeRequest();
    const result1 = await provider.send(ctx, request);
    const result2 = await provider.send(ctx, request);
    expect(result1.status).toBe('PROVIDER_ACCEPTED');
    expect(result1.providerMessageId).toBe(result2.providerMessageId);
    expect(provider.getSentMessages()).toHaveLength(1);
  });

  it('records sent messages with operational identifiers', async () => {
    const provider = new StubEmailProvider();
    const request = makeRequest();
    await provider.send(ctx, request);
    const [record] = provider.getSentMessages();
    expect(record.tenantId).toBe('tenant-1');
    expect(record.campaignId).toBe('campaign-1');
    expect(record.sequenceId).toBe('sequence-1');
    expect(record.executionId).toBe('execution-1');
    expect(record.idempotencyKey).toBe('idmp-1');
    expect(record.correlationId).toBe('corr-1');
    expect(record.recipientAddress).toBe('lead@example.com');
  });

  it('classifies 401 as non-retryable failure', async () => {
    const provider = new StubEmailProvider();
    provider.configureFailure({
      type: 'failure',
      classification: 'NON_RETRYABLE',
      errorMessage: 'Unauthorized',
      errorCode: '401',
    });
    const result = await provider.send(ctx, makeRequest());
    expect(result.status).toBe('FAILED');
    expect(result.retryClassification).toBe('NON_RETRYABLE');
    expect(result.providerErrorCode).toBe('401');
  });

  it('classifies 403 as non-retryable failure', async () => {
    const provider = new StubEmailProvider();
    provider.configureFailure({
      type: 'failure',
      classification: 'NON_RETRYABLE',
      errorMessage: 'Forbidden',
      errorCode: '403',
    });
    const result = await provider.send(ctx, makeRequest());
    expect(result.status).toBe('FAILED');
    expect(result.providerErrorCode).toBe('403');
  });

  it('classifies 429 as rate-limited', async () => {
    const provider = new StubEmailProvider();
    provider.configureFailure({
      type: 'failure',
      classification: 'RATE_LIMITED',
      errorMessage: 'Throttled',
      errorCode: '429',
      retryAfterMs: 5000,
    });
    const result = await provider.send(ctx, makeRequest());
    expect(result.status).toBe('RATE_LIMITED');
    expect(result.retryClassification).toBe('RATE_LIMITED');
    expect(result.retryAfterMs).toBe(5000);
  });

  it('classifies 5xx as retryable', async () => {
    const provider = new StubEmailProvider();
    provider.configureFailure({
      type: 'failure',
      classification: 'RETRYABLE',
      errorMessage: 'Internal server error',
      errorCode: '500',
    });
    const result = await provider.send(ctx, makeRequest());
    expect(result.status).toBe('FAILED');
    expect(result.retryClassification).toBe('RETRYABLE');
  });

  it('returns AMBIGUOUS for timeout scenario', async () => {
    const provider = new StubEmailProvider();
    provider.simulateAcceptedThenTimeout();
    const result = await provider.send(ctx, makeRequest());
    expect(result.status).toBe('AMBIGUOUS');
    expect(provider.getSentMessages()[0].simulatedStatus).toBe('AMBIGUOUS');
  });

  it('accepted-then-timeout preserves providerMessageId for safe retry', async () => {
    const provider = new StubEmailProvider();
    provider.simulateAcceptedThenTimeout();
    const request = makeRequest();
    const first = await provider.send(ctx, request);
    expect(first.status).toBe('AMBIGUOUS');
    provider.configureFailure({ type: 'success' });
    const result = await provider.send(ctx, request);
    expect(result.status).toBe('PROVIDER_ACCEPTED');
    expect(result.providerMessageId).toBe(provider.getSentMessages()[0].providerMessageId);
  });

  it('does not produce a second sent message for duplicate logical send', async () => {
    const provider = new StubEmailProvider();
    const request = makeRequest();
    await provider.send(ctx, request);
    await provider.send(ctx, request);
    expect(provider.getSentMessages()).toHaveLength(1);
  });

  it('reset clears recorded state and behavior', async () => {
    const provider = new StubEmailProvider();
    await provider.send(ctx, makeRequest());
    provider.reset();
    expect(provider.getSentMessages()).toHaveLength(0);
    const result = await provider.send(ctx, makeRequest());
    expect(result.status).toBe('PROVIDER_ACCEPTED');
  });
});
