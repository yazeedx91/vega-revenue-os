import { OpenAIProvider } from '../providers/openai.provider';
import { LLMProviderError } from '../llm-provider.interface';
import { FakeSecretsProvider } from './fake-secrets-provider';

describe('OpenAIProvider', () => {
  const secretProvider = new FakeSecretsProvider({ 'openai/api-key': 'sk-test' });
  const baseUrl = 'https://api.openai.example.com';

  function makeProvider(fetchImpl: typeof fetch) {
    return new OpenAIProvider({
      providerId: 'openai',
      baseUrl,
      secretName: 'openai/api-key',
      secretProvider,
      defaultModelId: 'gpt-4o-mini',
      fetchImpl,
    });
  }

  it('returns parsed structured output and usage', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'chatcmpl-123',
          choices: [{ message: { content: '{"answer":"yes"}' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
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
      modelId: 'gpt-4o-mini',
      messages: [{ role: 'system', content: 'You are a bot' }, { role: 'user', content: 'Hello' }],
      structuredOutputSchema: { type: 'object' },
      maxTokens: 100,
      correlationId: 'corr-1',
    });

    expect(result.providerId).toBe('openai');
    expect(result.modelId).toBe('gpt-4o-mini');
    expect(result.structured).toEqual({ answer: 'yes' });
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(5);
    expect(result.totalTokens).toBe(15);
    expect(result.costUsd).toBe(0);
    expect(result.finishReason).toBe('stop');

    const call = fetchImpl.mock.calls[0];
    const [url, init] = call;
    expect(url).toBe('https://api.openai.example.com/v1/chat/completions');
    expect((init as any).headers['Authorization']).toBe('Bearer sk-test');
    const body = JSON.parse((init as any).body);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.max_tokens).toBe(100);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('computes cost when per-token prices are supplied', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'chatcmpl-123',
          choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const provider = makeProvider(fetchImpl as unknown as typeof fetch);
    const result = await provider.invoke({
      tenantId: 't',
      missionId: 'm',
      executionId: 'e',
      agentId: 'a',
      agentVersion: '1',
      capability: 'chat',
      modelId: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 50,
      costPerInputTokenUsd: 0.00001,
      costPerOutputTokenUsd: 0.00003,
      correlationId: 'corr',
    });

    expect(result.costUsd).toBe(Number((10 * 0.00001 + 5 * 0.00003).toFixed(6)));
  });

  it('throws non-retryable AUTH on 401', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);

    await expect(
      provider.invoke({
        tenantId: 't', missionId: 'm', executionId: 'e', agentId: 'a', agentVersion: '1', capability: 'chat',
        messages: [{ role: 'user', content: 'hi' }], maxTokens: 50, correlationId: 'corr',
      }),
    ).rejects.toMatchObject({
      providerId: 'openai',
      code: 'AUTH',
      retryable: false,
    });
  });

  it('throws retryable RATE_LIMIT on 429', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response('Rate limited', { status: 429 }));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);

    await expect(
      provider.invoke({
        tenantId: 't', missionId: 'm', executionId: 'e', agentId: 'a', agentVersion: '1', capability: 'chat',
        messages: [{ role: 'user', content: 'hi' }], maxTokens: 50, correlationId: 'corr',
      }),
    ).rejects.toMatchObject({
      providerId: 'openai',
      code: 'RATE_LIMIT',
      retryable: true,
    });
  });

  it('throws retryable PROVIDER_ERROR on 5xx', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response('Server error', { status: 503 }));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);

    await expect(
      provider.invoke({
        tenantId: 't', missionId: 'm', executionId: 'e', agentId: 'a', agentVersion: '1', capability: 'chat',
        messages: [{ role: 'user', content: 'hi' }], maxTokens: 50, correlationId: 'corr',
      }),
    ).rejects.toMatchObject({
      providerId: 'openai',
      code: 'PROVIDER_ERROR',
      retryable: true,
    });
  });

  it('throws retryable TIMEOUT on network/abort error', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('fetch aborted'));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);

    await expect(
      provider.invoke({
        tenantId: 't', missionId: 'm', executionId: 'e', agentId: 'a', agentVersion: '1', capability: 'chat',
        messages: [{ role: 'user', content: 'hi' }], maxTokens: 50, correlationId: 'corr',
      }),
    ).rejects.toMatchObject({ providerId: 'openai', code: 'TIMEOUT', retryable: true });
  });

  it('throws MALFORMED_STRUCTURED_OUTPUT for non-JSON when JSON expected', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'chatcmpl-123',
          choices: [{ message: { content: 'not json' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 2 },
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
      providerId: 'openai',
      code: 'MALFORMED_STRUCTURED_OUTPUT',
      retryable: false,
    });
  });

  it('fails readiness when secret is missing', async () => {
    const missingSecretProvider = new FakeSecretsProvider();
    const provider = new OpenAIProvider({
      providerId: 'openai',
      baseUrl,
      secretName: 'openai/api-key',
      secretProvider: missingSecretProvider,
      fetchImpl: jest.fn(),
    });

    await expect(provider.checkReadiness()).rejects.toMatchObject({
      providerId: 'openai',
      code: 'MISSING_SECRET',
      retryable: false,
    });
  });
});
