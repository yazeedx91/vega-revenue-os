import type { LLMCompletion, PromptContext } from '@projectx/shared';

export interface ILLMClient {
  complete(context: PromptContext): Promise<LLMCompletion>;
}
