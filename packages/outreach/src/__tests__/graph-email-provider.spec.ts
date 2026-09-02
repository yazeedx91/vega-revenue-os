import type { ProviderSendRequest, TenantContext } from '@projectx/domain';
import type { ITokenProvider } from '@projectx/infrastructure';
import {
  asCampaignId,
  asCorrelationId,
  asIdempotencyKey,
  asOutreachExecutionId,
  asOutreachMessageId,
  asSequenceId,
  asTenantId,
} from '@projectx/shared';
import { GraphEmailProvider } from '../infrastructure/graph/graph-email-provider';
import { GraphHttpNetworkError, GraphHttpTimeoutError } from '../infrastructure/graph/fetch-graph-http-client';
import type { GraphHttpResponse, GraphSendMailRequest, GraphSentMessage, IGraphHttpClient } from '../infrastructure/graph/graph-http-client.interface';

/** Deterministic ITokenProvider test double — no MSAL, no network. */
class FakeTokenProvider implements ITokenProvider {
  callCount = 0;
  lastScopes: string[] | undefined;

  constructor(private readonly behavior: { type: 'success'; token?: string } | { type: 'failure'; message: string } = { type: 'success' }) {}

  async getAccessToken(scopes: string[]): Promise<string> {
    this.callCount += 1;
    this.lastScopes = scopes;
    if (this.behavior.type === 'failure') {
      throw new Error(this.behavior.message);
    }
    return this.behavior.token ?? 'fake-access-token';
  }
}

/** Deterministic IGraphHttpClient test double — no fetch, no network. */
class FakeGraphHttpClient implements IGraphHttpClient {
  callCount = 0;
  lastAccessToken: string | undefined;
  lastRequest: GraphSendMailRequest | undefined;
  getSentMessageCallCount = 0;
  lastGetSentMessageOptions:
    | { senderAddress: string; subject: string; recipientAddress: string; sentAfter: Date }
    | undefined;

  constructor(
    private readonly behavior:
      | { type: 'response'; response: GraphHttpResponse; sentMessage?: GraphSentMessage | null }
      | { type: 'throw'; error: Error } = {
      type: 'response',
      response: { status: 202, headers: {}, body: '' },
      sentMessage: null,
    },
  ) {}

  async sendMail(accessToken: string, request: GraphSendMailRequest): Promise<GraphHttpResponse> {
    this.callCount += 1;
    this.lastAccessToken = accessToken;
    this.lastRequest = request;
    if (this.behavior.type === 'throw') {
      throw this.behavior.error;
    }
    return this.behavior.response;
  }

  async getSentMessage(
    _accessToken: string,
    options: { senderAddress: string; subject: string; recipientAddress: string; sentAfter: Date },
  ): Promise<GraphSentMessage | null> {
    this.getSentMessageCallCount += 1;
    this.lastGetSentMessageOptions = options;
    if (this.behavior.type === 'throw') return null;
    return this.behavior.sentMessage ?? null;
  }
}

const ctx: TenantContext = { tenantId: asTenantId('tenant-a'), correlationId: asCorrelationId('corr-1') };

function makeRequest(overrides?: Partial<ProviderSendRequest>): ProviderSendRequest {
  return {
    idempotencyKey: asIdempotencyKey('idmp-1'),
    correlationId: ctx.correlationId,
    executionId: asOutreachExecutionId('exec-1'),
    tenantId: ctx.tenantId,
    campaignId: asCampaignId('camp-1'),
    sequenceId: asSequenceId('seq-1'),
    messageId: asOutreachMessageId('msg-1'),
    recipientAddress: 'prospect@example.com',
    subject: 'Hello',
    body: '<p>A validated message body.</p>',
    channel: 'email',
    ...overrides,
  };
}

describe('GraphEmailProvider — Phase 14 Milestone 4', () => {
  const senderAddress = 'sales@projectx.example.com';

  it('successful send → PROVIDER_ACCEPTED, providerMessageId absent when Sent Items lookup fails, correct request mapping', async () => {
    const tokenProvider = new FakeTokenProvider();
    const httpClient = new FakeGraphHttpClient({ type: 'response', response: { status: 202, headers: {}, body: '' } });
    const provider = new GraphEmailProvider({ tokenProvider, httpClient, senderAddress, isLiveEmailEnabled: () => true });

    const result = await provider.send(ctx, makeRequest());

    expect(result.status).toBe('PROVIDER_ACCEPTED');
    expect(result.providerMessageId).toBeUndefined();
    expect(result.internetMessageId).toBeUndefined();
    expect(httpClient.callCount).toBe(1);
    expect(httpClient.lastAccessToken).toBe('fake-access-token');
    expect(httpClient.lastRequest).toEqual({
      senderAddress,
      subject: 'Hello',
      bodyHtml: '<p>A validated message body.</p>',
      toRecipients: ['prospect@example.com'],
    });
  });

  it('successful send with Sent Items match → providerMessageId is real internetMessageId', async () => {
    const tokenProvider = new FakeTokenProvider();
    const realMessageId = '<real-msg-id@example.com>';
    const httpClient = new FakeGraphHttpClient({
      type: 'response',
      response: { status: 202, headers: {}, body: '' },
      sentMessage: { id: 'graph-msg-1', internetMessageId: realMessageId },
    });
    const provider = new GraphEmailProvider({ tokenProvider, httpClient, senderAddress, isLiveEmailEnabled: () => true });

    const request = makeRequest();
    const result = await provider.send(ctx, request);

    expect(result.status).toBe('PROVIDER_ACCEPTED');
    expect(result.providerMessageId).toBe(realMessageId);
    expect(result.internetMessageId).toBe(realMessageId);
    expect(httpClient.getSentMessageCallCount).toBe(1);
    expect(httpClient.lastGetSentMessageOptions).toMatchObject({
      senderAddress,
      subject: request.subject,
      recipientAddress: request.recipientAddress,
    });
    expect(httpClient.lastGetSentMessageOptions?.sentAfter).toBeInstanceOf(Date);
  });

  it('token acquisition failure → FAILED / NON_RETRYABLE, httpClient never invoked', async () => {
    const tokenProvider = new FakeTokenProvider({ type: 'failure', message: 'AADSTS700016: invalid client' });
    const httpClient = new FakeGraphHttpClient();
    const provider = new GraphEmailProvider({ tokenProvider, httpClient, senderAddress, isLiveEmailEnabled: () => true });

    const result = await provider.send(ctx, makeRequest());

    expect(result.status).toBe('FAILED');
    expect(result.retryClassification).toBe('NON_RETRYABLE');
    expect(result.providerErrorCode).toBe('GRAPH_TOKEN_ACQUISITION_FAILED');
    expect(result.providerErrorMessage).toContain('AADSTS700016');
    expect(httpClient.callCount).toBe(0);
  });

  it('Graph 401 → NON_RETRYABLE', async () => {
    const tokenProvider = new FakeTokenProvider();
    const httpClient = new FakeGraphHttpClient({
      type: 'response',
      response: { status: 401, headers: {}, body: JSON.stringify({ error: { code: 'InvalidAuthenticationToken', message: 'Access token is invalid' } }) },
    });
    const provider = new GraphEmailProvider({ tokenProvider, httpClient, senderAddress, isLiveEmailEnabled: () => true });

    const result = await provider.send(ctx, makeRequest());

    expect(result.status).toBe('FAILED');
    expect(result.retryClassification).toBe('NON_RETRYABLE');
    expect(result.providerErrorCode).toBe('GRAPH_UNAUTHORIZED');
    expect(result.providerErrorMessage).toContain('InvalidAuthenticationToken');
  });

  it('Graph 403 → NON_RETRYABLE', async () => {
    const tokenProvider = new FakeTokenProvider();
    const httpClient = new FakeGraphHttpClient({
      type: 'response',
      response: { status: 403, headers: {}, body: JSON.stringify({ error: { code: 'ErrorAccessDenied', message: 'Access is denied' } }) },
    });
    const provider = new GraphEmailProvider({ tokenProvider, httpClient, senderAddress, isLiveEmailEnabled: () => true });

    const result = await provider.send(ctx, makeRequest());

    expect(result.status).toBe('FAILED');
    expect(result.retryClassification).toBe('NON_RETRYABLE');
    expect(result.providerErrorCode).toBe('GRAPH_FORBIDDEN');
  });

  it('Graph 429 with Retry-After → AMBIGUOUS (request may have been accepted)', async () => {
    const tokenProvider = new FakeTokenProvider();
    const httpClient = new FakeGraphHttpClient({
      type: 'response',
      response: { status: 429, headers: { 'retry-after': '30' }, body: JSON.stringify({ error: { code: 'TooManyRequests', message: 'Rate limited' } }) },
    });
    const provider = new GraphEmailProvider({ tokenProvider, httpClient, senderAddress, isLiveEmailEnabled: () => true });

    const result = await provider.send(ctx, makeRequest());

    expect(result.status).toBe('AMBIGUOUS');
    expect(result.retryClassification).toBeUndefined();
    expect(result.providerErrorCode).toBe('GRAPH_RATE_LIMITED_AMBIGUOUS');
  });

  it('Graph 429 without Retry-After → AMBIGUOUS', async () => {
    const tokenProvider = new FakeTokenProvider();
    const httpClient = new FakeGraphHttpClient({ type: 'response', response: { status: 429, headers: {}, body: '' } });
    const provider = new GraphEmailProvider({ tokenProvider, httpClient, senderAddress, isLiveEmailEnabled: () => true });

    const result = await provider.send(ctx, makeRequest());

    expect(result.status).toBe('AMBIGUOUS');
    expect(result.providerErrorCode).toBe('GRAPH_RATE_LIMITED_AMBIGUOUS');
  });

  it('Graph 5xx → AMBIGUOUS (request may have been accepted)', async () => {
    const tokenProvider = new FakeTokenProvider();
    const httpClient = new FakeGraphHttpClient({ type: 'response', response: { status: 503, headers: {}, body: JSON.stringify({ error: { code: 'ServiceUnavailable', message: 'Try again later' } }) } });
    const provider = new GraphEmailProvider({ tokenProvider, httpClient, senderAddress, isLiveEmailEnabled: () => true });

    const result = await provider.send(ctx, makeRequest());

    expect(result.status).toBe('AMBIGUOUS');
    expect(result.providerErrorCode).toBe('GRAPH_SERVER_ERROR_AMBIGUOUS');
  });

  it('timeout (GraphHttpTimeoutError thrown by the HTTP client) → AMBIGUOUS', async () => {
    const tokenProvider = new FakeTokenProvider();
    const httpClient = new FakeGraphHttpClient({ type: 'throw', error: new GraphHttpTimeoutError('Graph sendMail request timed out after 30000ms') });
    const provider = new GraphEmailProvider({ tokenProvider, httpClient, senderAddress, isLiveEmailEnabled: () => true });

    const result = await provider.send(ctx, makeRequest());

    expect(result.status).toBe('AMBIGUOUS');
    expect(result.providerErrorCode).toBe('GRAPH_TIMEOUT_AMBIGUOUS');
  });

  it('network failure (GraphHttpNetworkError thrown by the HTTP client) → AMBIGUOUS', async () => {
    const tokenProvider = new FakeTokenProvider();
    const httpClient = new FakeGraphHttpClient({ type: 'throw', error: new GraphHttpNetworkError('ECONNRESET') });
    const provider = new GraphEmailProvider({ tokenProvider, httpClient, senderAddress, isLiveEmailEnabled: () => true });

    const result = await provider.send(ctx, makeRequest());

    expect(result.status).toBe('AMBIGUOUS');
    expect(result.providerErrorCode).toBe('GRAPH_NETWORK_ERROR_AMBIGUOUS');
  });

  it('malformed/unexpected response status → NON_RETRYABLE with a diagnostic message', async () => {
    const tokenProvider = new FakeTokenProvider();
    const httpClient = new FakeGraphHttpClient({ type: 'response', response: { status: 999, headers: {}, body: 'not json' } });
    const provider = new GraphEmailProvider({ tokenProvider, httpClient, senderAddress, isLiveEmailEnabled: () => true });

    const result = await provider.send(ctx, makeRequest());

    expect(result.status).toBe('FAILED');
    expect(result.retryClassification).toBe('NON_RETRYABLE');
    expect(result.providerErrorCode).toBe('GRAPH_UNEXPECTED_RESPONSE');
    expect(result.providerErrorMessage).toContain('999');
  });

  it('a Graph 400 with an unparseable error body still classifies NON_RETRYABLE with a generic message', async () => {
    const tokenProvider = new FakeTokenProvider();
    const httpClient = new FakeGraphHttpClient({ type: 'response', response: { status: 400, headers: {}, body: 'not json at all' } });
    const provider = new GraphEmailProvider({ tokenProvider, httpClient, senderAddress, isLiveEmailEnabled: () => true });

    const result = await provider.send(ctx, makeRequest());

    expect(result.status).toBe('FAILED');
    expect(result.retryClassification).toBe('NON_RETRYABLE');
    expect(result.providerErrorCode).toBe('GRAPH_CLIENT_ERROR');
    expect(result.providerErrorMessage).toContain('400');
  });

  describe('runtime kill-switch (OUTREACH_LIVE_EMAIL_ENABLED)', () => {
    it('live disabled → blocked before any external HTTP (no token, no Graph sendMail)', async () => {
      const tokenProvider = new FakeTokenProvider();
      const httpClient = new FakeGraphHttpClient();
      const provider = new GraphEmailProvider({ tokenProvider, httpClient, senderAddress, isLiveEmailEnabled: () => false });

      const result = await provider.send(ctx, makeRequest());

      expect(result.status).toBe('FAILED');
      expect(result.retryClassification).toBe('NON_RETRYABLE');
      expect(result.providerErrorCode).toBe('LIVE_EMAIL_DISABLED');
      expect(tokenProvider.callCount).toBe(0);
      expect(httpClient.callCount).toBe(0);
    });

    it("default resolver (no override) with process.env.OUTREACH_LIVE_EMAIL_ENABLED unset → send blocked", async () => {
      const original = process.env.OUTREACH_LIVE_EMAIL_ENABLED;
      delete process.env.OUTREACH_LIVE_EMAIL_ENABLED;
      try {
        const tokenProvider = new FakeTokenProvider();
        const httpClient = new FakeGraphHttpClient();
        const provider = new GraphEmailProvider({ tokenProvider, httpClient, senderAddress });

        const result = await provider.send(ctx, makeRequest());

        expect(result.providerErrorCode).toBe('LIVE_EMAIL_DISABLED');
        expect(tokenProvider.callCount).toBe(0);
        expect(httpClient.callCount).toBe(0);
      } finally {
        if (original === undefined) delete process.env.OUTREACH_LIVE_EMAIL_ENABLED;
        else process.env.OUTREACH_LIVE_EMAIL_ENABLED = original;
      }
    });

    it("default resolver with process.env.OUTREACH_LIVE_EMAIL_ENABLED='false' → send blocked", async () => {
      const original = process.env.OUTREACH_LIVE_EMAIL_ENABLED;
      process.env.OUTREACH_LIVE_EMAIL_ENABLED = 'false';
      try {
        const tokenProvider = new FakeTokenProvider();
        const httpClient = new FakeGraphHttpClient();
        const provider = new GraphEmailProvider({ tokenProvider, httpClient, senderAddress });

        const result = await provider.send(ctx, makeRequest());

        expect(result.providerErrorCode).toBe('LIVE_EMAIL_DISABLED');
        expect(tokenProvider.callCount).toBe(0);
        expect(httpClient.callCount).toBe(0);
      } finally {
        if (original === undefined) delete process.env.OUTREACH_LIVE_EMAIL_ENABLED;
        else process.env.OUTREACH_LIVE_EMAIL_ENABLED = original;
      }
    });

    it.each(['1', 'TRUE', 'yes', 'enabled', ' true', 'true '])(
      "invalid truthy-looking value '%s' → send blocked (only the exact string 'true' enables)",
      async (value) => {
        const original = process.env.OUTREACH_LIVE_EMAIL_ENABLED;
        process.env.OUTREACH_LIVE_EMAIL_ENABLED = value;
        try {
          const tokenProvider = new FakeTokenProvider();
          const httpClient = new FakeGraphHttpClient();
          const provider = new GraphEmailProvider({ tokenProvider, httpClient, senderAddress });

          const result = await provider.send(ctx, makeRequest());

          expect(result.providerErrorCode).toBe('LIVE_EMAIL_DISABLED');
          expect(tokenProvider.callCount).toBe(0);
          expect(httpClient.callCount).toBe(0);
        } finally {
          if (original === undefined) delete process.env.OUTREACH_LIVE_EMAIL_ENABLED;
          else process.env.OUTREACH_LIVE_EMAIL_ENABLED = original;
        }
      },
    );

    it("flag === 'true' → proceeds to the normal token/HTTP path, subject to all other controls", async () => {
      const tokenProvider = new FakeTokenProvider();
      const httpClient = new FakeGraphHttpClient({ type: 'response', response: { status: 202, headers: {}, body: '' } });
      const provider = new GraphEmailProvider({ tokenProvider, httpClient, senderAddress, isLiveEmailEnabled: () => true });

      const result = await provider.send(ctx, makeRequest());

      expect(result.status).toBe('PROVIDER_ACCEPTED');
      expect(tokenProvider.callCount).toBe(1);
      expect(httpClient.callCount).toBe(1);
    });

    it('duplicate idempotency key → skips Graph sendMail and returns the same PROVIDER_ACCEPTED result', async () => {
      const tokenProvider = new FakeTokenProvider();
      const httpClient = new FakeGraphHttpClient({ type: 'response', response: { status: 202, headers: {}, body: '' } });
      const provider = new GraphEmailProvider({ tokenProvider, httpClient, senderAddress, isLiveEmailEnabled: () => true });

      const request = makeRequest();
      const first = await provider.send(ctx, request);
      expect(first.status).toBe('PROVIDER_ACCEPTED');
      expect(httpClient.callCount).toBe(1);

      const second = await provider.send(ctx, request);
      expect(second.status).toBe('PROVIDER_ACCEPTED');
      expect(second.providerMessageId).toBe(first.providerMessageId);
      expect(httpClient.callCount).toBe(1);
      expect(tokenProvider.callCount).toBe(1);
    });
  });

  describe('checkHealth()', () => {
    it('healthy when token acquisition succeeds', async () => {
      const tokenProvider = new FakeTokenProvider();
      const provider = new GraphEmailProvider({ tokenProvider, httpClient: new FakeGraphHttpClient(), senderAddress, isLiveEmailEnabled: () => true });

      const health = await provider.checkHealth(ctx);

      expect(health.healthy).toBe(true);
    });

    it('unhealthy with a reason when token acquisition fails', async () => {
      const tokenProvider = new FakeTokenProvider({ type: 'failure', message: 'AADSTS7000215: invalid client secret' });
      const provider = new GraphEmailProvider({ tokenProvider, httpClient: new FakeGraphHttpClient(), senderAddress, isLiveEmailEnabled: () => true });

      const health = await provider.checkHealth(ctx);

      expect(health.healthy).toBe(false);
      expect(health.reason).toContain('AADSTS7000215');
    });
  });
});
