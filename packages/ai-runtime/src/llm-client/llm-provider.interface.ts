import type { LLMCompletion, PromptContext } from '@projectx/shared';

export interface LLMProviderOptions {
  readonly model: string;
  readonly maxTokens: number;
  readonly timeoutMs: number;
}

export interface ILLMProvider {
  readonly name: string;
  readonly supportedFamilies: string[];
  complete(context: PromptContext, options: LLMProviderOptions): Promise<LLMCompletion>;
}
