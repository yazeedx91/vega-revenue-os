import type { TenantContext } from '@projectx/domain';
import type { ITokenProvider } from '@projectx/infrastructure';
import { asCorrelationId, asTenantId } from '@projectx/shared';
import { GraphSubscriptionClient } from '../graph-subscription-client';

describe('GraphSubscriptionClient', () => {
  const ctx: TenantContext = { tenantId: asTenantId('tenant-1'), correlationId: asCorrelationId('corr-1') };

  const tokenProvider: ITokenProvider = {
    async getAccessToken(): Promise<string> {
      return 'test-token';
    },
  };

  function buildClient() {
    return new GraphSubscriptionClient({ tokenProvider, baseUrl: 'https://graph.example.com/v1.0' });
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates a subscription and parses the response', async () => {
    const client = buildClient();
    const mockFetch = jest.fn().mockResolvedValue({
      status: 201,
      text: async () =>
        JSON.stringify({
          id: 'sub-123',
          resource: '/users/mailbox@example.com/messages',
          notificationUrl: 'https://example.com/webhook',
          expirationDateTime: '2026-12-31T23:59:59Z',
          clientState: 'secret',
        }),
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const result = await client.createSubscription(ctx, {
      resource: '/users/mailbox@example.com/messages',
      notificationUrl: 'https://example.com/webhook',
      expirationDateTime: new Date('2026-12-31T23:59:59Z'),
      clientState: 'secret',
    });

    expect(result.success).toBe(true);
    expect(result.value!.id).toBe('sub-123');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://graph.example.com/v1.0/subscriptions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    );
  });

  it('lists subscriptions', async () => {
    const client = buildClient();
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      text: async () =>
        JSON.stringify({
          value: [
            {
              id: 'sub-1',
              resource: '/users/a/messages',
              notificationUrl: 'https://example.com/a',
              expirationDateTime: '2026-12-31T23:59:59Z',
            },
          ],
        }),
    }) as unknown as typeof fetch;

    const result = await client.listSubscriptions(ctx);
    expect(result.success).toBe(true);
    expect(result.value).toHaveLength(1);
    expect(result.value![0].id).toBe('sub-1');
  });

  it('deletes a subscription', async () => {
    const client = buildClient();
    global.fetch = jest.fn().mockResolvedValue({
      status: 204,
      text: async () => '',
    }) as unknown as typeof fetch;

    const result = await client.deleteSubscription(ctx, 'sub-1');
    expect(result.success).toBe(true);
  });

  it('returns an error when token acquisition fails', async () => {
    const failingProvider: ITokenProvider = {
      async getAccessToken(): Promise<string> {
        throw new Error('token-error');
      },
    };
    const client = new GraphSubscriptionClient({ tokenProvider: failingProvider });
    const result = await client.createSubscription(ctx, {
      resource: '/users/a/messages',
      notificationUrl: 'https://example.com/a',
      expirationDateTime: new Date(),
      clientState: 's',
    });
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe('GRAPH_TOKEN_ACQUISITION_FAILED');
  });

  it('classifies Graph HTTP errors without throwing', async () => {
    const client = buildClient();
    global.fetch = jest.fn().mockResolvedValue({
      status: 429,
      text: async () => JSON.stringify({ error: { code: 'ApplicationThrottled', message: 'throttled' } }),
    }) as unknown as typeof fetch;

    const result = await client.createSubscription(ctx, {
      resource: '/users/a/messages',
      notificationUrl: 'https://example.com/a',
      expirationDateTime: new Date(),
      clientState: 's',
    });
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe('GRAPH_RATE_LIMITED');
  });
});
