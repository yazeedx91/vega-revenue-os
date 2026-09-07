import type { IEmbeddingProvider } from './embedding-provider.interface';

export interface IEmbeddingProviderRegistry {
  register(provider: IEmbeddingProvider): void;
  get(providerId: string): IEmbeddingProvider | undefined;
  all(): readonly IEmbeddingProvider[];
}

export class EmbeddingProviderRegistry implements IEmbeddingProviderRegistry {
  private readonly providers = new Map<string, IEmbeddingProvider>();

  register(provider: IEmbeddingProvider): void {
    if (this.providers.has(provider.providerId)) {
      throw new Error(`Embedding provider ${provider.providerId} is already registered`);
    }
    this.providers.set(provider.providerId, provider);
  }

  get(providerId: string): IEmbeddingProvider | undefined {
    return this.providers.get(providerId);
  }

  all(): readonly IEmbeddingProvider[] {
    return Array.from(this.providers.values());
  }
}
