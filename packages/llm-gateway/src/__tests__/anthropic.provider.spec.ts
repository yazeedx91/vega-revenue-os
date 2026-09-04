import { AnthropicProvider } from '../providers/anthropic.provider';
import { LLMProviderError } from '../llm-provider.interface';
import { FakeSecretsProvider } from './fake-secrets-provider';

describe('AnthropicProvider', () => {
  const secretProvider = new FakeSecretsProvider({ 'anthropic/api-key': 'sk-ant-test' });
  const baseUrl = 'https://api.anthropic.example.com';

  function makeProvider(fetchImpl: typeof fetch) {
    return new AnthropicProvider({
      providerId: 'anthropic',
      baseUrl,
      secretName: 'anthropic/api-key',
      secretProvider,
      defaultModelId: 'claude-3-haiku-20240307',
      fetchImpl,
    });
  }

  it('returns parsed structured output and usage', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'msg-123',
          content: [{ type: 'text', text: '{"answer":"yes"}' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 8, output_tokens: 4 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const provider = makeProvider(fetchImpl as unknown as typeof fetch);
    const result = await provider.invoke({
      tenantId: 'tenant-1',
      missionId: 'mission-1',
      executionId: 'exec-1',
      agentId: 'agent-1',
      agentVersion: '1.0.0',
      capability: 'chat',
      modelId: 'claude-3-haiku-20240307',
      messages: [{ role: 'system', content: 'You are a bot' }, { role: 'user', content: 'Hello' }],
      structuredOutputSchema: { type: 'object' },
      maxTokens: 100,
      correlationId: 'corr-1',
    });

    expect(result.providerId).toBe('anthropic');
    expect(result.modelId).toBe('claude-3-haiku-20240307');
    expect(result.structured).toEqual({ answer: 'yes' });
    expect(result.inputTokens).toBe(8);
    expect(result.outputTokens).toBe(4);
    expect(result.totalTokens).toBe(12);
    expect(result.finishReason).toBe('end_turn');

    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse((init as any).body);
    expect(body.model).toBe('claude-3-haiku-20240307');
    expect(body.max_tokens).toBe(100);
    expect(body.system).toBe('You are a bot');
    expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
    expect((init as any).headers['x-api-key']).toBe('sk-ant-test');
  });

  it('computes cost when per-token prices are supplied', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'msg-123',
          content: [{ type: 'text', text: '{"ok":true}' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 20, output_tokens: 10 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const provider = makeProvider(fetchImpl as unknown as typeof fetch);
    const result = await provider.invoke({
      tenantId: 't', missionId: 'm', executionId: 'e', agentId: 'a', agentVersion: '1',
      capability: 'chat', modelId: 'claude-3-sonnet-20240229',
      messages: [{ role: 'user', content: 'hi' }], maxTokens: 50,
      costPerInputTokenUsd: 0.000003, costPerOutputTokenUsd: 0.000015,
      correlationId: 'corr',
    });

    expect(result.costUsd).toBe(Number((20 * 0.000003 + 10 * 0.000015).toFixed(6)));
  });

  it('throws retryable OVERLOADED on 529', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response('Overloaded', { status: 529 }));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);

    await expect(
      provider.invoke({
        tenantId: 't', missionId: 'm', executionId: 'e', agentId: 'a', agentVersion: '1', capability: 'chat',
        messages: [{ role: 'user', content: 'hi' }], maxTokens: 50, correlationId: 'corr',
      }),
    ).rejects.toMatchObject({
      providerId: 'anthropic',
      code: 'OVERLOADED',
      retryable: true,
    });
  });

  it('throws non-retryable AUTH on 403', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response('Forbidden', { status: 403 }));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);

    await expect(
      provider.invoke({
        tenantId: 't', missionId: 'm', executionId: 'e', agentId: 'a', agentVersion: '1', capability: 'chat',
        messages: [{ role: 'user', content: 'hi' }], maxTokens: 50, correlationId: 'corr',
      }),
    ).rejects.toMatchObject({
      providerId: 'anthropic',
      code: 'AUTH',
      retryable: false,
    });
  });

  it('throws MALFORMED_STRUCTURED_OUTPUT for non-JSON when JSON expected', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'msg-123',
          content: [{ type: 'text', text: 'plain text' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 2 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);

    await expect(
      provider.invoke({
        tenantId: 't', missionId: 'm', executionId: 'e', agentId: 'a', agentVersion: '1', capability: 'chat',
        messages: [{ role: 'user', content: 'hi' }], maxTokens: 50, correlationId: 'corr',
        structuredOutputSchema: { type: 'object' },
      }),
    ).rejects.toMatchObject({
      providerId: 'anthropic',
      code: 'MALFORMED_STRUCTURED_OUTPUT',
      retryable: false,
    });
  });

  it('fails readiness when secret is missing', async () => {
    const missingSecretProvider = new FakeSecretsProvider();
    const provider = new AnthropicProvider({
      providerId: 'anthropic',
      baseUrl,
      secretName: 'anthropic/api-key',
      secretProvider: missingSecretProvider,
      fetchImpl: jest.fn(),
    });

    await expect(provider.checkReadiness()).rejects.toMatchObject({
      providerId: 'anthropic',
      code: 'MISSING_SECRET',
      retryable: false,
    });
  });
});
