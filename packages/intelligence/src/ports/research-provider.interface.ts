import type { TenantContext } from '@projectx/domain';

export interface AccountCandidate {
  providerAccountId: string;
  name: string;
  domain?: string;
  industry?: string;
  employeeCount?: number;
  annualRevenueUsd?: number;
  location?: string;
  raw?: unknown;
}

export interface CompanyIntelligence {
  providerAccountId: string;
  firmographics: {
    industry?: string;
    employeeCount?: number;
    annualRevenueUsd?: number;
    headquarters?: string;
    territories?: string[];
  };
  technographics: string[];
  signals: BuyingSignal[];
  raw?: unknown;
}

export interface ContactCandidate {
  providerContactId: string;
  accountId: string;
  name?: string;
  title?: string;
  role?: string;
  seniority?: string;
  email?: string;
  phone?: string;
  linkedInUrl?: string;
  channels?: string[];
  raw?: unknown;
}

export interface EnrichedContact extends ContactCandidate {
  confidence: number;
  validationStatus: 'VALID' | 'INVALID' | 'UNCERTAIN';
}

export interface BuyingSignal {
  signalId: string;
  signalType: string;
  observedSignal: string;
  interpretedSignal: string;
  observedAt: Date;
  source: string;
  confidence: number;
  relevance: number;
  raw?: unknown;
}

export interface AccountDiscoveryQuery {
  icpProfileId: string;
  keywords?: string[];
  territories?: string[];
  industries?: string[];
  maxResults: number;
}

export interface IResearchProvider {
  readonly providerId: string;
  discoverAccounts(ctx: TenantContext, query: AccountDiscoveryQuery): Promise<AccountCandidate[]>;
  getCompanyIntelligence(ctx: TenantContext, providerAccountId: string): Promise<CompanyIntelligence>;
  discoverContacts(ctx: TenantContext, accountId: string): Promise<ContactCandidate[]>;
  enrichContact(ctx: TenantContext, contact: ContactCandidate): Promise<EnrichedContact>;
  detectSignals(ctx: TenantContext, providerAccountId: string): Promise<BuyingSignal[]>;
}
