import type { TenantContext } from '@projectx/domain';
import type {
  AccountCandidate,
  ContactCandidate,
} from '../ports/research-provider.interface';
import type {
  ExternalAccountRecord,
  ExternalContactRecord,
  IBusinessSystemIntelligenceAdapter,
} from '../ports/business-system-intelligence.interface';

/**
 * Deterministic in-memory stub for the Dynamics 365 connector — the first
 * concrete implementation of IBusinessSystemIntelligenceAdapter (see
 * ADR-125). No live Dynamics API calls are made in this phase.
 */
export class DynamicsIntelligenceAdapterStub implements IBusinessSystemIntelligenceAdapter {
  private readonly accounts = new Map<string, ExternalAccountRecord[]>();
  private readonly contacts = new Map<string, ExternalContactRecord[]>();

  seedAccounts(tenantId: string, records: ExternalAccountRecord[]): void {
    this.accounts.set(tenantId, records);
  }

  seedContacts(tenantId: string, records: ExternalContactRecord[]): void {
    this.contacts.set(tenantId, records);
  }

  async findAccounts(ctx: TenantContext, query: { name?: string; domain?: string; industry?: string; limit: number }): Promise<AccountCandidate[]> {
    const records = this.accounts.get(ctx.tenantId) ?? [];
    const filtered = records.filter((a) => {
      if (query.name && !a.name.toLowerCase().includes(query.name.toLowerCase())) return false;
      if (query.domain && a.domain !== query.domain) return false;
      if (query.industry && a.industry !== query.industry) return false;
      return true;
    });
    return filtered.slice(0, query.limit).map((a) => ({
      providerAccountId: a.accountId,
      name: a.name,
      domain: a.domain,
      industry: a.industry,
      employeeCount: a.employeeCount,
      annualRevenueUsd: a.annualRevenueUsd,
    }));
  }

  async findContacts(ctx: TenantContext, accountId: string): Promise<ContactCandidate[]> {
    const records = this.contacts.get(ctx.tenantId) ?? [];
    return records
      .filter((c) => c.accountId === accountId)
      .map((c) => ({
        providerContactId: c.contactId,
        accountId: c.accountId,
        name: c.name,
        title: c.title,
        email: c.email,
        phone: c.phone,
      }));
  }

  async findDuplicateAccount(_ctx: TenantContext, candidate: AccountCandidate): Promise<ExternalAccountRecord | null> {
    const records = this.accounts.get(_ctx.tenantId) ?? [];
    return records.find((a) => a.name === candidate.name || (candidate.domain && a.domain === candidate.domain)) ?? null;
  }

  async findDuplicateContact(_ctx: TenantContext, candidate: ContactCandidate): Promise<ExternalContactRecord | null> {
    const records = this.contacts.get(_ctx.tenantId) ?? [];
    return records.find((c) => c.email && c.email === candidate.email) ?? null;
  }
}
