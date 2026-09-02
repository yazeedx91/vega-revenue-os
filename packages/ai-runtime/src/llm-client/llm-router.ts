import type { ITelemetry } from '@projectx/infrastructure';
import type { LLMCompletion, PromptContext } from '@projectx/shared';
import type { ILLMClient } from './llm-client.interface';
import type { ILLMProvider, LLMProviderOptions } from './llm-provider.interface';

export interface LLMRouterOptions {
  readonly defaultModelFamily: string;
  readonly defaultMaxTokens: number;
  readonly defaultTimeoutMs: number;
}

export class LLMRouter implements ILLMClient {
  private readonly providerMap = new Map<string, ILLMProvider[]>();

  constructor(
    private readonly providers: ILLMProvider[],
    private readonly telemetry: ITelemetry,
    private readonly options: LLMRouterOptions,
  ) {
    for (const provider of providers) {
      for (const family of provider.supportedFamilies) {
        const list = this.providerMap.get(family) ?? [];
        list.push(provider);
        this.providerMap.set(family, list);
      }
    }
  }

  async complete(context: PromptContext): Promise<LLMCompletion> {
    const family = context.modelFamily ?? this.options.defaultModelFamily;
    const maxTokens = context.maxTokens ?? this.options.defaultMaxTokens;
    const timeoutMs = context.timeoutMs ?? this.options.defaultTimeoutMs;

    const candidates = this.providerMap.get(family) ?? [];
    if (candidates.length === 0) {
      throw new Error(`No LLM provider registered for model family ${family}`);
    }

    const providerOptions: LLMProviderOptions = {
      model: family,
      maxTokens,
      timeoutMs,
    };

    const lastError: Error[] = [];
    for (let attempt = 0; attempt < candidates.length; attempt += 1) {
      const provider = candidates[attempt];
      try {
        const result = await this.telemetry.span(
          `llm.complete.${provider.name}`,
          () => provider.complete(context, providerOptions),
        );
        this.telemetry.increment('llm.router.success', 1, {
          provider: provider.name,
          family,
        });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        lastError.push(new Error(`${provider.name}: ${message}`));
        this.telemetry.increment('llm.router.failure', 1, {
          provider: provider.name,
          family,
        });
      }
    }

    throw new Error(`All LLM providers failed for family ${family}: ${lastError.map((e) => e.message).join('; ')}`);
  }
}
