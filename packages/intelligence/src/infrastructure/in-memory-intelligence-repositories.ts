import type { Account, Contact, ICPProfile, Lead, ResearchEvidence } from '@projectx/domain';
import { TenantIsolationError, AuthorizationError } from '@projectx/domain';
import type {
  AccountRepositoryContext,
  ContactRepositoryContext,
  ICPProfileRepositoryContext,
  LeadRepositoryContext,
  ResearchEvidenceRepositoryContext,
  IAccountRepository,
  IContactRepository,
  IICPProfileRepository,
  ILeadRepository,
  IResearchEvidenceRepository,
} from '@projectx/infrastructure';

export class InMemoryICPProfileRepository implements IICPProfileRepository {
  private readonly store = new Map<string, ICPProfile>();

  private key(ctx: ICPProfileRepositoryContext, id: string): string {
    return `${ctx.tenantId}:${ctx.workspaceId}:${id}`;
  }

  async findById(ctx: ICPProfileRepositoryContext, id: string): Promise<ICPProfile | null> {
    return this.store.get(this.key(ctx, id)) ?? null;
  }

  async save(ctx: ICPProfileRepositoryContext, profile: ICPProfile): Promise<void> {
    this.store.set(this.key(ctx, profile.id as string), profile);
  }

  async findActiveByWorkspace(ctx: ICPProfileRepositoryContext): Promise<ICPProfile | null> {
    return (
      Array.from(this.store.values()).find(
        (p) => p.tenantId === ctx.tenantId && p.workspaceId === ctx.workspaceId && p.status === 'ACTIVE',
      ) ?? null
    );
  }
}

export class InMemoryAccountRepository implements IAccountRepository {
  private readonly store = new Map<string, Account>();

  private key(ctx: AccountRepositoryContext, id: string): string {
    return `${ctx.tenantId}:${ctx.workspaceId}:${id}`;
  }

  async findById(ctx: AccountRepositoryContext, id: string): Promise<Account | null> {
    return this.store.get(this.key(ctx, id)) ?? null;
  }

  async save(ctx: AccountRepositoryContext, account: Account): Promise<void> {
    if (ctx.tenantId !== account.tenantId) {
      throw new TenantIsolationError(
        `Account tenant ${account.tenantId} does not match context tenant ${ctx.tenantId}`,
      );
    }
    if (ctx.workspaceId !== account.workspaceId) {
      throw new AuthorizationError(
        `Account workspace ${account.workspaceId} does not match authorized workspace ${ctx.workspaceId}`,
      );
    }
    this.store.set(this.key(ctx, account.id as string), account);
  }

  async findQualified(ctx: AccountRepositoryContext): Promise<Account[]> {
    return Array.from(this.store.values()).filter(
      (a) => a.tenantId === ctx.tenantId && a.workspaceId === ctx.workspaceId && a.status === 'QUALIFIED',
    );
  }
}

export class InMemoryContactRepository implements IContactRepository {
  private readonly store = new Map<string, Contact>();

  private key(ctx: ContactRepositoryContext, id: string): string {
    return `${ctx.tenantId}:${ctx.workspaceId}:${id}`;
  }

  async findById(ctx: ContactRepositoryContext, id: string): Promise<Contact | null> {
    return this.store.get(this.key(ctx, id)) ?? null;
  }

  async save(ctx: ContactRepositoryContext, contact: Contact): Promise<void> {
    if (ctx.tenantId !== contact.tenantId) {
      throw new TenantIsolationError(
        `Contact tenant ${contact.tenantId} does not match context tenant ${ctx.tenantId}`,
      );
    }
    if (ctx.workspaceId !== contact.workspaceId) {
      throw new AuthorizationError(
        `Contact workspace ${contact.workspaceId} does not match authorized workspace ${ctx.workspaceId}`,
      );
    }
    this.store.set(this.key(ctx, contact.id as string), contact);
  }

  async findByAccount(ctx: ContactRepositoryContext, accountId: string): Promise<Contact[]> {
    return Array.from(this.store.values()).filter(
      (c) => c.tenantId === ctx.tenantId && c.workspaceId === ctx.workspaceId && c.accountId === accountId,
    );
  }
}

export class InMemoryLeadRepository implements ILeadRepository {
  private readonly store = new Map<string, Lead>();

  private key(ctx: LeadRepositoryContext, id: string): string {
    return `${ctx.tenantId}:${ctx.workspaceId}:${id}`;
  }

  async findById(ctx: LeadRepositoryContext, id: string): Promise<Lead | null> {
    return this.store.get(this.key(ctx, id)) ?? null;
  }

  async save(ctx: LeadRepositoryContext, lead: Lead): Promise<void> {
    this.store.set(this.key(ctx, lead.id as string), lead);
  }

  async findByMission(ctx: LeadRepositoryContext, missionId: string): Promise<Lead[]> {
    return Array.from(this.store.values()).filter(
      (l) => l.tenantId === ctx.tenantId && l.workspaceId === ctx.workspaceId && l.missionId === missionId,
    );
  }

  async findQualified(ctx: LeadRepositoryContext): Promise<Lead[]> {
    return Array.from(this.store.values()).filter(
      (l) => l.tenantId === ctx.tenantId && l.workspaceId === ctx.workspaceId && l.status === 'QUALIFIED',
    );
  }
}

export class InMemoryResearchEvidenceRepository implements IResearchEvidenceRepository {
  private readonly store = new Map<string, ResearchEvidence>();

  private key(ctx: ResearchEvidenceRepositoryContext, id: string): string {
    return `${ctx.tenantId}:${ctx.workspaceId}:${id}`;
  }

  async save(ctx: ResearchEvidenceRepositoryContext, evidence: ResearchEvidence): Promise<void> {
    this.store.set(this.key(ctx, evidence.evidenceId as string), evidence);
  }

  async findById(ctx: ResearchEvidenceRepositoryContext, id: string): Promise<ResearchEvidence | null> {
    return this.store.get(this.key(ctx, id)) ?? null;
  }

  async findByAccount(ctx: ResearchEvidenceRepositoryContext, accountId: string): Promise<ResearchEvidence[]> {
    return Array.from(this.store.values()).filter(
      (e) => e.tenantId === ctx.tenantId && e.workspaceId === ctx.workspaceId && e.props.accountId === accountId,
    );
  }

  async findByContact(ctx: ResearchEvidenceRepositoryContext, contactId: string): Promise<ResearchEvidence[]> {
    return Array.from(this.store.values()).filter(
      (e) => e.tenantId === ctx.tenantId && e.workspaceId === ctx.workspaceId && e.props.contactId === contactId,
    );
  }

  async findByMission(ctx: ResearchEvidenceRepositoryContext, missionId: string): Promise<ResearchEvidence[]> {
    return Array.from(this.store.values()).filter(
      (e) => e.tenantId === ctx.tenantId && e.workspaceId === ctx.workspaceId && e.props.missionId === missionId,
    );
  }

  async findByFingerprint(ctx: ResearchEvidenceRepositoryContext, fingerprint: string): Promise<ResearchEvidence | null> {
    return (
      Array.from(this.store.values()).find(
        (e) => e.tenantId === ctx.tenantId && e.workspaceId === ctx.workspaceId && e.props.evidenceFingerprint === fingerprint,
      ) ?? null
    );
  }
}
