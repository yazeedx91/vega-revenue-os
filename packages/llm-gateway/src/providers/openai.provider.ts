import type {
  ILLMProvider,
  LLMProviderConfig,
  LLMProviderRequest,
  LLMProviderResult,
} from '../llm-provider.interface';
import { LLMProviderError } from '../llm-provider.interface';

export class OpenAIProvider implements ILLMProvider {
  readonly providerId = 'openai';
  readonly capabilities = ['chat', 'structured_output'] as const;

  constructor(private readonly config: LLMProviderConfig) {}

  async checkReadiness(): Promise<void> {
    try {
      await this.config.secretProvider.getSecret(this.config.secretName);
    } catch (err) {
      throw new LLMProviderError(
        `OpenAI provider not ready: secret ${this.config.secretName} unavailable`,
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
        `OpenAI secret unavailable: ${this.config.secretName}`,
        this.providerId,
        'MISSING_SECRET',
        false,
        err,
      );
    }

    const modelId = request.modelId ?? this.config.defaultModelId ?? 'gpt-4o-mini';
    const body: Record<string, unknown> = {
      model: modelId,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: request.maxTokens,
    };
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    if (request.structuredOutputSchema) {
      body.response_format = { type: 'json_object' };
    }

    const url = `${this.config.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
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
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
      });
    } catch (err) {
      throw new LLMProviderError(
        `OpenAI request failed: ${err instanceof Error ? err.message : String(err)}`,
        this.providerId,
        'TIMEOUT',
        true,
        err,
      );
    }

    const completedAt = new Date();
    const latencyMs = completedAt.getTime() - startedAt.getTime();

    if (!response.ok) {
      const status = response.status;
      const text = await response.text().catch(() => 'unknown');
      const { retryable, code } = this.classifyHttpError(status, text);
      throw new LLMProviderError(
        `OpenAI returned ${status}: ${text}`,
        this.providerId,
        code,
        retryable,
      );
    }

    const json = (await response.json()) as Record<string, unknown>;
    const providerRequestId = (json.id as string) ?? 'unknown';
    const choice = ((json.choices as Array<Record<string, unknown>>) ?? [])[0];
    const message = (choice?.message as Record<string, unknown>) ?? {};
    const content = (message.content as string) ?? '';
    const finishReason = (choice?.finish_reason as string) ?? 'unknown';

    const usage = (json.usage as Record<string, number>) ?? {};
    const inputTokens = Math.floor(usage.prompt_tokens ?? 0);
    const outputTokens = Math.floor(usage.completion_tokens ?? 0);
    const totalTokens = Math.floor(usage.total_tokens ?? inputTokens + outputTokens);

    let structured: unknown | undefined;
    if (request.structuredOutputSchema && content) {
      try {
        structured = JSON.parse(content);
      } catch {
        throw new LLMProviderError(
          'OpenAI response did not contain valid JSON for structured output',
          this.providerId,
          'MALFORMED_STRUCTURED_OUTPUT',
          false,
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
        'OpenAI request deadline has already passed',
        this.providerId,
        'DEADLINE_EXCEEDED',
        false,
      );
    }
  }

  private classifyHttpError(status: number, _text: string): { retryable: boolean; code: string } {
    if (status === 429) return { retryable: true, code: 'RATE_LIMIT' };
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
