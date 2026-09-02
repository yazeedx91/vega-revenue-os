import type { TenantContext } from '@projectx/domain';
import type { AccountCandidate, ContactCandidate } from './research-provider.interface';

export interface ExternalAccountRecord {
  accountId: string;
  name: string;
  domain?: string;
  industry?: string;
  employeeCount?: number;
  annualRevenueUsd?: number;
  owner?: string;
  modifiedAt: Date;
}

export interface ExternalContactRecord {
  contactId: string;
  accountId: string;
  name?: string;
  title?: string;
  email?: string;
  phone?: string;
  modifiedAt: Date;
}

/**
 * Read-side, intelligence-scoped slice of the canonical business-system
 * abstraction (see ADR-125). Concrete implementations connect to a specific
 * external business system (Dynamics 365 first; future: Salesforce, SAP,
 * custom industrial applications).
 */
export interface IBusinessSystemIntelligenceAdapter {
  findAccounts(ctx: TenantContext, query: { name?: string; domain?: string; industry?: string; limit: number }): Promise<AccountCandidate[]>;
  findContacts(ctx: TenantContext, accountId: string): Promise<ContactCandidate[]>;
  findDuplicateAccount(ctx: TenantContext, candidate: AccountCandidate): Promise<ExternalAccountRecord | null>;
  findDuplicateContact(ctx: TenantContext, candidate: ContactCandidate): Promise<ExternalContactRecord | null>;
}
