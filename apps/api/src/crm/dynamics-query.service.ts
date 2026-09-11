import { Injectable } from '@nestjs/common';
import type { TenantContext } from '@projectx/domain';
import type { IBusinessSystemIntelligenceAdapter } from '@projectx/intelligence';

@Injectable()
export class DynamicsQueryService {
  constructor(private readonly adapter: IBusinessSystemIntelligenceAdapter) {}
  async accounts(ctx: TenantContext, query: { name?: string; domain?: string; industry?: string; limit: number }) {
    return (await this.adapter.findAccounts(ctx, query)).map(({ providerAccountId, name, domain, industry, employeeCount, annualRevenueUsd }) => ({ providerAccountId, name, domain, industry, employeeCount, annualRevenueUsd }));
  }
  async contacts(ctx: TenantContext, accountId: string) {
    return (await this.adapter.findContacts(ctx, accountId)).map(({ providerContactId, accountId: parentAccountId, name, title }) => ({ providerContactId, accountId: parentAccountId, name, title }));
  }
}
