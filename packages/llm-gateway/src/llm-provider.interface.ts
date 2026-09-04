import type { ISecretsProvider } from '@projectx/infrastructure';

export interface LLMMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface LLMProviderRequest {
  readonly tenantId: string;
  readonly missionId: string;
  readonly executionId: string;
  readonly agentId: string;
  readonly agentVersion: string;
  readonly capability: string;
  readonly modelId?: string;
  readonly modelFamily?: string;
  readonly messages: readonly LLMMessage[];
  readonly structuredOutputSchema?: Record<string, unknown>;
  readonly maxTokens: number;
  readonly temperature?: number;
  readonly deadline?: Date;
  readonly correlationId: string;
  readonly idempotencyKey?: string;
  readonly metadata?: Record<string, unknown>;
  readonly costPerInputTokenUsd?: number;
  readonly costPerOutputTokenUsd?: number;
  readonly budget?: { readonly maxCostUsd: number; readonly maxTokens: number };
  /**
   * Stable identity for a single logical LLM call (one router.invoke may span
   * multiple provider attempts). Combined with the per-attempt index it forms
   * the auditable identity of each invocation attempt. When absent the router
   * mints one.
   */
  readonly llmCallId?: string;
}

export interface LLMProviderResult {
  readonly providerId: string;
  readonly modelId: string;
  readonly providerRequestId: string;
  readonly content: string;
  readonly structured?: unknown;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly finishReason: string;
  readonly startedAt: Date;
  readonly completedAt: Date;
}

export interface LLMProviderConfig {
  readonly providerId: string;
  readonly baseUrl: string;
  readonly secretName: string;
  readonly secretProvider: ISecretsProvider;
  readonly defaultModelId?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface ILLMProvider {
  readonly providerId: string;
  readonly capabilities: readonly string[];
  invoke(request: LLMProviderRequest): Promise<LLMProviderResult>;
  checkReadiness(): Promise<void>;
}

export class LLMProviderError extends Error {
  constructor(
    message: string,
    public readonly providerId: string,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly cause?: unknown,
    /**
     * Whether the provider request was actually dispatched over HTTP. A failure
     * before submission (missing secret, deadline, not-registered) legitimately
     * has zero usage; a submitted failure may have consumed unknown usage.
     */
    public readonly submitted: boolean = false,
    /**
     * Token usage parsed from a provider response when available even though the
     * call failed (e.g. a malformed structured output). Absent when usage is
     * unknown.
     */
    public readonly usage?: {
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly totalTokens: number;
    },
  ) {
    super(message);
    this.name = 'LLMProviderError';
  }
}
