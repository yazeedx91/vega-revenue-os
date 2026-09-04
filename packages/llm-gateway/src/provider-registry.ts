import type { ILLMProvider } from './llm-provider.interface';

export interface IProviderRegistry {
  register(provider: ILLMProvider): void;
  get(providerId: string): ILLMProvider | undefined;
  all(): readonly ILLMProvider[];
}

export class ProviderRegistry implements IProviderRegistry {
  private readonly providers = new Map<string, ILLMProvider>();

  register(provider: ILLMProvider): void {
    if (this.providers.has(provider.providerId)) {
      throw new Error(`Provider ${provider.providerId} is already registered`);
    }
    this.providers.set(provider.providerId, provider);
  }

  get(providerId: string): ILLMProvider | undefined {
    return this.providers.get(providerId);
  }

  all(): readonly ILLMProvider[] {
    return Array.from(this.providers.values());
  }
}
