import type { LLMCompletion, PromptContext } from '@projectx/shared';
import type { ILLMProvider, LLMProviderOptions } from '../llm-client/llm-provider.interface';

export class FakeLLMProvider implements ILLMProvider {
  readonly name: string;
  readonly supportedFamilies: string[];

  constructor(
    name: string,
    supportedFamilies: string[],
    private readonly responseFactory: (context: PromptContext, options: LLMProviderOptions) => LLMCompletion,
  ) {
    this.name = name;
    this.supportedFamilies = supportedFamilies;
  }

  async complete(context: PromptContext, options: LLMProviderOptions): Promise<LLMCompletion> {
    return this.responseFactory(context, options);
  }
}

export function staticLLMCompletion(completion: LLMCompletion): ILLMProvider {
  return new FakeLLMProvider('static', ['gpt-4o', 'fake'], () => completion);
}
