import type { TenantContext } from '@projectx/domain';
import type { ISecretsProvider, ITokenProvider } from '@projectx/infrastructure';
import { MsalTokenProvider } from '@projectx/infrastructure';
import type { AccountCandidate, ContactCandidate } from '../ports/research-provider.interface';
import type { ExternalAccountRecord, ExternalContactRecord, IBusinessSystemIntelligenceAdapter } from '../ports/business-system-intelligence.interface';
import type { DynamicsAuthority, IDynamicsAuthorityResolver } from './dynamics-authority-resolver';
import type { IDataverseReadHttpClient } from './dataverse-read-http-client';

const maxPages = 3;
const maxLimit = 100;
const scopes = (organizationUrl: string) => [`${organizationUrl}/.default`];

export class DynamicsReadError extends Error { constructor(message: string) { super(message); this.name = 'DynamicsReadError'; } }
export interface DynamicsTokenProviderFactory { create(config: { tenantId: string; clientId: string; clientSecret: string }): ITokenProvider; }
export class MsalDynamicsTokenProviderFactory implements DynamicsTokenProviderFactory { create(config: { tenantId: string; clientId: string; clientSecret: string }) { return new MsalTokenProvider(config); } }

export interface DynamicsIntelligenceAdapterConfig { authorityResolver: IDynamicsAuthorityResolver; secretsProvider: ISecretsProvider; tokenProviderFactory: DynamicsTokenProviderFactory; httpClient: IDataverseReadHttpClient; }

export class DynamicsIntelligenceAdapter implements IBusinessSystemIntelligenceAdapter {
  constructor(private readonly config: DynamicsIntelligenceAdapterConfig) {}

  async findAccounts(ctx: TenantContext, query: { name?: string; domain?: string; industry?: string; limit: number }): Promise<AccountCandidate[]> {
    const limit = this.limit(query.limit);
    const filters = [query.name && `contains(name,'${this.escape(query.name)}')`, query.domain && `websiteurl eq '${this.escape(query.domain)}'`, query.industry && `industrycode eq '${this.escape(query.industry)}'`].filter(Boolean);
    const path = `accounts?$select=accountid,name,websiteurl,industrycode,numberofemployees,revenue,modifiedon&$top=${limit}${filters.length ? `&$filter=${encodeURIComponent(filters.join(' and '))}` : ''}`;
    const rows = await this.pages(ctx, path, limit);
    return rows.map((row) => this.account(row));
  }

  async findContacts(ctx: TenantContext, accountId: string): Promise<ContactCandidate[]> {
    this.id(accountId);
    const path = `contacts?$select=contactid,_parentcustomerid_value,fullname,jobtitle,emailaddress1,telephone1,modifiedon&$top=${maxLimit}&$filter=${encodeURIComponent(`_parentcustomerid_value eq ${accountId}`)}`;
    return (await this.pages(ctx, path, maxLimit)).map((row) => this.contact(row));
  }

  async findDuplicateAccount(ctx: TenantContext, candidate: AccountCandidate): Promise<ExternalAccountRecord | null> {
    const [found] = await this.findAccounts(ctx, { name: candidate.name, domain: candidate.domain, limit: 1 });
    return found ? { accountId: found.providerAccountId, name: found.name, domain: found.domain, industry: found.industry, employeeCount: found.employeeCount, annualRevenueUsd: found.annualRevenueUsd, modifiedAt: new Date(0) } : null;
  }

  async findDuplicateContact(ctx: TenantContext, candidate: ContactCandidate): Promise<ExternalContactRecord | null> {
    const contacts = await this.findContacts(ctx, candidate.accountId);
    const found = contacts.find((contact) => candidate.email ? contact.email?.toLowerCase() === candidate.email.toLowerCase() : contact.name === candidate.name);
    return found ? { contactId: found.providerContactId, accountId: found.accountId, name: found.name, title: found.title, email: found.email, phone: found.phone, modifiedAt: new Date(0) } : null;
  }

  private async pages(ctx: TenantContext, initialPath: string, limit: number): Promise<any[]> {
    const { authority, token } = await this.authorize(ctx);
    const values: any[] = [];
    let path: string | undefined = initialPath;
    for (let page = 0; path && page < maxPages && values.length < limit; page += 1) {
      let result;
      try { result = await this.config.httpClient.get(token, authority.organizationUrl, path); }
      catch { throw new DynamicsReadError('Dynamics read failed'); }
      values.push(...result.value.slice(0, limit - values.length));
      path = result.nextLink;
    }
    return values;
  }

  private async authorize(ctx: TenantContext): Promise<{ authority: DynamicsAuthority; token: string }> {
    if (!ctx.workspaceId) throw new DynamicsReadError('Dynamics access denied');
    const authority = await this.config.authorityResolver.resolve(ctx);
    if (!authority || authority.tenantId !== ctx.tenantId || authority.workspaceId !== ctx.workspaceId) throw new DynamicsReadError('Dynamics access denied');
    try {
      const [clientId, clientSecret] = await Promise.all([this.config.secretsProvider.getSecret(authority.clientIdSecretReference), this.config.secretsProvider.getSecret(authority.clientSecretReference)]);
      const token = await this.config.tokenProviderFactory.create({ tenantId: authority.entraTenantId, clientId, clientSecret }).getAccessToken(scopes(authority.organizationUrl));
      if (!token) throw new Error('missing token');
      return { authority, token };
    } catch { throw new DynamicsReadError('Dynamics authorization failed'); }
  }

  private account(value: any): AccountCandidate {
    const id = this.string(value?.accountid, 128, true) as string; const name = this.string(value?.name, 500, true) as string;
    return { providerAccountId: id, name, domain: this.string(value?.websiteurl, 500), industry: this.string(value?.industrycode, 200), employeeCount: this.number(value?.numberofemployees), annualRevenueUsd: this.number(value?.revenue), raw: { provider: 'dynamics365', source: 'dataverse' } };
  }
  private contact(value: any): ContactCandidate {
    return { providerContactId: this.string(value?.contactid, 128, true) as string, accountId: this.string(value?._parentcustomerid_value, 128, true) as string, name: this.string(value?.fullname, 500), title: this.string(value?.jobtitle, 500), email: this.string(value?.emailaddress1, 320), phone: this.string(value?.telephone1, 100), raw: { provider: 'dynamics365', source: 'dataverse' } };
  }
  private string(value: unknown, max: number, required = false): string | undefined | never { if (value === null || value === undefined || value === '') { if (required) throw new DynamicsReadError('Dynamics response schema invalid'); return undefined; } if (typeof value !== 'string' || value.length > max) throw new DynamicsReadError('Dynamics response schema invalid'); return value; }
  private number(value: unknown): number | undefined { if (value === null || value === undefined) return undefined; if (typeof value !== 'number' || !Number.isFinite(value)) throw new DynamicsReadError('Dynamics response schema invalid'); return value; }
  private limit(value: number) { if (!Number.isInteger(value) || value < 1 || value > maxLimit) throw new DynamicsReadError('Dynamics query limit invalid'); return value; }
  private escape(value: string) { if (!value || value.length > 500) throw new DynamicsReadError('Dynamics query invalid'); return value.replace(/'/g, "''"); }
  private id(value: string) { if (!/^[0-9a-fA-F-]{36}$/.test(value)) throw new DynamicsReadError('Dynamics identifier invalid'); }
}
