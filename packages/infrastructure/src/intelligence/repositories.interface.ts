import type { Account, Contact, ICPProfile, Lead, ResearchEvidence } from '@projectx/domain';
import type { TenantContext } from '@projectx/domain';
import type { IRepository } from '@projectx/domain';

export interface ICPProfileRepositoryContext extends TenantContext {
  readonly workspaceId: string;
}

export interface IICPProfileRepository {
  findById(ctx: ICPProfileRepositoryContext, id: string): Promise<ICPProfile | null>;
  findByVersionId(ctx: ICPProfileRepositoryContext, versionId: string): Promise<ICPProfile | null>;
  save(ctx: ICPProfileRepositoryContext, aggregate: ICPProfile): Promise<void>;
  findActiveByWorkspace(ctx: ICPProfileRepositoryContext): Promise<ICPProfile | null>;
}

export interface AccountRepositoryContext extends TenantContext {
  readonly workspaceId: string;
}

export interface ContactRepositoryContext extends TenantContext {
  readonly workspaceId: string;
}

export interface LeadRepositoryContext extends TenantContext {
  readonly workspaceId: string;
}

export interface IAccountRepository {
  findById(ctx: AccountRepositoryContext, id: string): Promise<Account | null>;
  save(ctx: AccountRepositoryContext, aggregate: Account): Promise<void>;
  findQualified(ctx: AccountRepositoryContext): Promise<Account[]>;
}

export interface IContactRepository {
  findById(ctx: ContactRepositoryContext, id: string): Promise<Contact | null>;
  save(ctx: ContactRepositoryContext, aggregate: Contact): Promise<void>;
  findByAccount(ctx: ContactRepositoryContext, accountId: string): Promise<Contact[]>;
}

export interface ILeadRepository {
  findById(ctx: LeadRepositoryContext, id: string): Promise<Lead | null>;
  save(ctx: LeadRepositoryContext, lead: Lead): Promise<void>;
  findByMission(ctx: LeadRepositoryContext, missionId: string): Promise<Lead[]>;
  findQualified(ctx: LeadRepositoryContext): Promise<Lead[]>;
}

export interface ResearchEvidenceRepositoryContext extends TenantContext {
  readonly workspaceId: string;
}

export interface IResearchEvidenceRepository {
  save(ctx: ResearchEvidenceRepositoryContext, evidence: ResearchEvidence): Promise<void>;
  findById(ctx: ResearchEvidenceRepositoryContext, id: string): Promise<ResearchEvidence | null>;
  findByAccount(ctx: ResearchEvidenceRepositoryContext, accountId: string): Promise<ResearchEvidence[]>;
  findByContact(ctx: ResearchEvidenceRepositoryContext, contactId: string): Promise<ResearchEvidence[]>;
  findByMission(ctx: ResearchEvidenceRepositoryContext, missionId: string): Promise<ResearchEvidence[]>;
  findByFingerprint(ctx: ResearchEvidenceRepositoryContext, fingerprint: string): Promise<ResearchEvidence | null>;
}
