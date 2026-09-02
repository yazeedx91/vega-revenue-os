import type { Lead, LeadId } from '@projectx/domain';
import type { TenantContext } from '@projectx/domain';

export interface ILeadRepository {
  load(ctx: TenantContext, id: LeadId): Promise<Lead | null>;
  save(ctx: TenantContext, lead: Lead): Promise<void>;
}
