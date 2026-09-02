import { FakeLLMProvider, LLMRouter, NoOpTelemetry } from '@projectx/ai-runtime';
import type { PromptContext } from '@projectx/shared';

describe('LLMRouter', () => {
  it('selects a provider by model family and returns a completion', async () => {
    const provider = new FakeLLMProvider('alpha', ['gpt-4o'], (_ctx, options) => ({
      content: 'hello',
      model: options.model,
      provider: 'alpha',
      tokensInput: 1,
      tokensOutput: 1,
      costUsd: 0.001,
    }));

    const router = new LLMRouter(
      [provider],
      new NoOpTelemetry(),
      { defaultModelFamily: 'gpt-4o', defaultMaxTokens: 100, defaultTimeoutMs: 1000 },
    );

    const result = await router.complete({
      systemPromptVersion: '1',
      userMessage: 'test',
      toolsAvailable: [],
      modelFamily: 'gpt-4o',
    });

    expect(result.content).toBe('hello');
    expect(result.provider).toBe('alpha');
  });

  it('falls back to a second provider when the first fails', async () => {
    const failing = new FakeLLMProvider('fail', ['gpt-4o'], () => {
      throw new Error('boom');
    });
    const succeeding = new FakeLLMProvider('ok', ['gpt-4o'], () => ({
      content: 'ok',
      model: 'gpt-4o',
      provider: 'ok',
      tokensInput: 1,
      tokensOutput: 1,
      costUsd: 0.001,
    }));

    const router = new LLMRouter(
      [failing, succeeding],
      new NoOpTelemetry(),
      { defaultModelFamily: 'gpt-4o', defaultMaxTokens: 100, defaultTimeoutMs: 1000 },
    );

    const result = await router.complete({
      systemPromptVersion: '1',
      userMessage: 'test',
      toolsAvailable: [],
    });

    expect(result.content).toBe('ok');
  });

  it('throws when no provider supports the requested family', async () => {
    const router = new LLMRouter(
      [],
      new NoOpTelemetry(),
      { defaultModelFamily: 'unknown', defaultMaxTokens: 100, defaultTimeoutMs: 1000 },
    );

    await expect(
      router.complete({
        systemPromptVersion: '1',
        userMessage: 'test',
        toolsAvailable: [],
      }),
    ).rejects.toThrow('No LLM provider registered');
  });
});
