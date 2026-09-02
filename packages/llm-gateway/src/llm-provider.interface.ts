import type { LLMCompletion } from '@projectx/shared';

export interface ILLMProvider {
  readonly providerId: string;
  readonly supportedModels: string[];
  complete(input: ProviderCompletionInput): Promise<LLMCompletion>;
}

export interface ProviderCompletionInput {
  model: string;
  systemPrompt: string;
  userMessage: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'json' | 'text';
}
