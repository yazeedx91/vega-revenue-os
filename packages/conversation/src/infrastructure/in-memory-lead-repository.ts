import type { Lead, LeadId, TenantContext } from '@projectx/domain';
import type { ILeadRepository } from '../ports/lead-repository.interface';

export class InMemoryLeadRepository implements ILeadRepository {
  private readonly store = new Map<string, Lead>();

  private key(tenantId: string, id: string): string {
    return `${tenantId}:${id}`;
  }

  async load(ctx: TenantContext, id: LeadId): Promise<Lead | null> {
    return this.store.get(this.key(ctx.tenantId as string, id)) ?? null;
  }

  async save(ctx: TenantContext, lead: Lead): Promise<void> {
    if (lead.tenantId !== ctx.tenantId) {
      throw new Error('Tenant mismatch');
    }
    this.store.set(this.key(ctx.tenantId as string, lead.id), lead);
  }
}
