import type {
  ILLMProvider,
  LLMProviderConfig,
  LLMProviderRequest,
  LLMProviderResult,
} from '../llm-provider.interface';
import { LLMProviderError } from '../llm-provider.interface';

export class AnthropicProvider implements ILLMProvider {
  readonly providerId = 'anthropic';
  readonly capabilities = ['chat', 'structured_output'] as const;

  constructor(private readonly config: LLMProviderConfig) {}

  async checkReadiness(): Promise<void> {
    try {
      await this.config.secretProvider.getSecret(this.config.secretName);
    } catch (err) {
      throw new LLMProviderError(
        `Anthropic provider not ready: secret ${this.config.secretName} unavailable`,
        this.providerId,
        'MISSING_SECRET',
        false,
        err,
      );
    }
  }

  async invoke(request: LLMProviderRequest): Promise<LLMProviderResult> {
    const startedAt = new Date();
    this.checkDeadline(request.deadline, startedAt);

    let apiKey: string;
    try {
      apiKey = await this.config.secretProvider.getSecret(this.config.secretName);
    } catch (err) {
      throw new LLMProviderError(
        `Anthropic secret unavailable: ${this.config.secretName}`,
        this.providerId,
        'MISSING_SECRET',
        false,
        err,
      );
    }

    const modelId = request.modelId ?? this.config.defaultModelId ?? 'claude-3-haiku-20240307';

    const systemMessage = request.messages.find((m) => m.role === 'system')?.content;
    const userMessages = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const body: Record<string, unknown> = {
      model: modelId,
      max_tokens: request.maxTokens,
      messages: userMessages,
    };
    if (systemMessage) {
      body.system = systemMessage;
    }
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    const url = `${this.config.baseUrl.replace(/\/$/, '')}/v1/messages`;
    const timeoutMs = request.deadline
      ? Math.max(0, request.deadline.getTime() - startedAt.getTime())
      : this.config.timeoutMs ?? 60_000;

    let response: Response;
    try {
      const fetchImpl = this.config.fetchImpl ?? fetch;
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
      });
    } catch (err) {
      throw new LLMProviderError(
        `Anthropic request failed: ${err instanceof Error ? err.message : String(err)}`,
        this.providerId,
        'TIMEOUT',
        true,
        err,
        true,
      );
    }

    const completedAt = new Date();
    const latencyMs = completedAt.getTime() - startedAt.getTime();

    if (!response.ok) {
      const status = response.status;
      const text = await response.text().catch(() => 'unknown');
      const { retryable, code } = this.classifyHttpError(status, text);
      throw new LLMProviderError(
        `Anthropic returned ${status}: ${text}`,
        this.providerId,
        code,
        retryable,
        undefined,
        true,
      );
    }

    const json = (await response.json()) as Record<string, unknown>;
    const providerRequestId = (json.id as string) ?? 'unknown';
    const contentBlocks = (json.content as Array<Record<string, unknown>>) ?? [];
    const textBlock = contentBlocks.find((b) => b.type === 'text') as Record<string, unknown> | undefined;
    const content = (textBlock?.text as string) ?? '';
    const finishReason = (json.stop_reason as string) ?? 'unknown';

    const usage = (json.usage as Record<string, number>) ?? {};
    const inputTokens = Math.floor(usage.input_tokens ?? 0);
    const outputTokens = Math.floor(usage.output_tokens ?? 0);
    const totalTokens = inputTokens + outputTokens;

    let structured: unknown | undefined;
    if (request.structuredOutputSchema && content) {
      try {
        structured = JSON.parse(content);
      } catch {
        throw new LLMProviderError(
          'Anthropic response did not contain valid JSON for structured output',
          this.providerId,
          'MALFORMED_STRUCTURED_OUTPUT',
          false,
          undefined,
          true,
          { inputTokens, outputTokens, totalTokens },
        );
      }
    }

    const costUsd = this.computeCost(inputTokens, outputTokens, request);

    return {
      providerId: this.providerId,
      modelId,
      providerRequestId,
      content,
      structured,
      inputTokens,
      outputTokens,
      totalTokens,
      costUsd,
      latencyMs,
      finishReason,
      startedAt,
      completedAt,
    };
  }

  private checkDeadline(deadline: Date | undefined, startedAt: Date): void {
    if (deadline && startedAt > deadline) {
      throw new LLMProviderError(
        'Anthropic request deadline has already passed',
        this.providerId,
        'DEADLINE_EXCEEDED',
        false,
      );
    }
  }

  private classifyHttpError(status: number, _text: string): { retryable: boolean; code: string } {
    if (status === 429) return { retryable: true, code: 'RATE_LIMIT' };
    if (status === 529) return { retryable: true, code: 'OVERLOADED' };
    if (status >= 500) return { retryable: true, code: 'PROVIDER_ERROR' };
    if (status === 401 || status === 403) return { retryable: false, code: 'AUTH' };
    if (status >= 400 && status < 500) return { retryable: false, code: 'BAD_REQUEST' };
    return { retryable: true, code: 'UNKNOWN' };
  }

  private computeCost(inputTokens: number, outputTokens: number, request: LLMProviderRequest): number {
    const inCost = request.costPerInputTokenUsd ?? 0;
    const outCost = request.costPerOutputTokenUsd ?? 0;
    return Number((inputTokens * inCost + outputTokens * outCost).toFixed(6));
  }
}
