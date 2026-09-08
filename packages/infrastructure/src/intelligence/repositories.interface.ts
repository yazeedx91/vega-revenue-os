import type { Account, Contact, ICPProfile, Lead, ResearchEvidence } from '@projectx/domain';
import type { TenantContext } from '@projectx/domain';
import type { IRepository } from '@projectx/domain';

export interface IICPProfileRepository extends IRepository<ICPProfile, string> {}

export interface AccountRepositoryContext extends TenantContext {
  readonly workspaceId: string;
}

export interface IAccountRepository {
  findById(ctx: AccountRepositoryContext, id: string): Promise<Account | null>;
  save(ctx: AccountRepositoryContext, aggregate: Account): Promise<void>;
  findQualified(ctx: AccountRepositoryContext): Promise<Account[]>;
}

export interface IContactRepository extends IRepository<Contact, string> {
  findByAccount(ctx: TenantContext, accountId: string): Promise<Contact[]>;
}

export interface ILeadRepository extends IRepository<Lead, string> {
  findByMission(ctx: TenantContext, missionId: string): Promise<Lead[]>;
  findQualified(ctx: TenantContext): Promise<Lead[]>;
}

export interface IResearchEvidenceRepository {
  save(ctx: TenantContext, evidence: ResearchEvidence): Promise<void>;
  findById(ctx: TenantContext, id: string): Promise<ResearchEvidence | null>;
  findByAccount(ctx: TenantContext, accountId: string): Promise<ResearchEvidence[]>;
  findByContact(ctx: TenantContext, contactId: string): Promise<ResearchEvidence[]>;
  findByMission(ctx: TenantContext, missionId: string): Promise<ResearchEvidence[]>;
}
