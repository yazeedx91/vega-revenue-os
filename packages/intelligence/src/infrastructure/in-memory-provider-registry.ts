import type { TenantContext } from '@projectx/domain';
import type { IProviderRegistry, ProviderSelectionCriteria } from '../ports/provider-registry.interface';
import type { IResearchProvider } from '../ports/research-provider.interface';

export class InMemoryProviderRegistry implements IProviderRegistry {
  private readonly providers: IResearchProvider[] = [];

  register(provider: IResearchProvider): void {
    this.providers.push(provider);
  }

  async select(
    _ctx: TenantContext,
    criteria: ProviderSelectionCriteria,
  ): Promise<IResearchProvider | null> {
    if (criteria.preferredProviderIds && criteria.preferredProviderIds.length > 0) {
      const preferred = this.providers.find((p) => criteria.preferredProviderIds!.includes(p.providerId));
      if (preferred) return preferred;
    }
    return this.providers[0] ?? null;
  }

  async list(_ctx: TenantContext): Promise<IResearchProvider[]> {
    return [...this.providers];
  }
}
