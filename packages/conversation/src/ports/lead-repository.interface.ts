import type { Lead, LeadId, TenantContext } from '@projectx/domain';

export interface ILeadRepository {
  load(ctx: TenantContext, id: LeadId): Promise<Lead | null>;
  save(ctx: TenantContext, lead: Lead): Promise<void>;
}
