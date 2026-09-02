import type { TenantContext } from '@projectx/domain';
import type {
  AccountCandidate,
  AccountDiscoveryQuery,
  BuyingSignal,
  CompanyIntelligence,
  ContactCandidate,
  EnrichedContact,
  IResearchProvider,
} from '../ports/research-provider.interface';

export interface StubResearchProviderData {
  accounts: AccountCandidate[];
  companyIntelligence: Map<string, CompanyIntelligence>;
  contacts: Map<string, ContactCandidate[]>;
  enrichedContacts: Map<string, EnrichedContact>;
  signals: Map<string, BuyingSignal[]>;
}

export class StubResearchProvider implements IResearchProvider {
  readonly providerId = 'stub-research';

  constructor(private readonly data: StubResearchProviderData) {}

  async discoverAccounts(ctx: TenantContext, query: AccountDiscoveryQuery): Promise<AccountCandidate[]> {
    return this.data.accounts.slice(0, query.maxResults);
  }

  async getCompanyIntelligence(_ctx: TenantContext, providerAccountId: string): Promise<CompanyIntelligence> {
    return this.data.companyIntelligence.get(providerAccountId) ?? {
      providerAccountId,
      firmographics: {},
      technographics: [],
      signals: [],
    };
  }

  async discoverContacts(_ctx: TenantContext, accountId: string): Promise<ContactCandidate[]> {
    return this.data.contacts.get(accountId) ?? [];
  }

  async enrichContact(_ctx: TenantContext, contact: ContactCandidate): Promise<EnrichedContact> {
    const cached = this.data.enrichedContacts.get(contact.providerContactId);
    if (cached) return cached;
    return {
      ...contact,
      confidence: 0.75,
      validationStatus: 'UNCERTAIN',
    };
  }

  async detectSignals(_ctx: TenantContext, providerAccountId: string): Promise<BuyingSignal[]> {
    return this.data.signals.get(providerAccountId) ?? [];
  }
}
