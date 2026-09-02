import type { TenantContext } from '@projectx/domain';
import type { IResearchProvider } from './research-provider.interface';

export interface ProviderSelectionCriteria {
  capability: 'discover-accounts' | 'company-intelligence' | 'discover-contacts' | 'enrich-contact' | 'detect-signals';
  preferredProviderIds?: string[];
  maxCostUsd?: number;
  minReliability?: number;
}

export interface IProviderRegistry {
  register(provider: IResearchProvider): void;
  select(ctx: TenantContext, criteria: ProviderSelectionCriteria): Promise<IResearchProvider | null>;
  list(ctx: TenantContext): Promise<IResearchProvider[]>;
}
