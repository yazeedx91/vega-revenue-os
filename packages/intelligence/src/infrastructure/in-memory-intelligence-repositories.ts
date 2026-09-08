import type { Account, Contact, ICPProfile, Lead, ResearchEvidence, TenantContext } from '@projectx/domain';
import { TenantIsolationError, AuthorizationError } from '@projectx/domain';
import type {
  AccountRepositoryContext,
  IAccountRepository,
  IContactRepository,
  IICPProfileRepository,
  ILeadRepository,
  IResearchEvidenceRepository,
} from '@projectx/infrastructure';

export class InMemoryICPProfileRepository implements IICPProfileRepository {
  private readonly store = new Map<string, ICPProfile>();

  private key(ctx: TenantContext, id: string): string {
    return `${ctx.tenantId}:${id}`;
  }

  async findById(ctx: TenantContext, id: string): Promise<ICPProfile | null> {
    return this.store.get(this.key(ctx, id)) ?? null;
  }

  async save(ctx: TenantContext, profile: ICPProfile): Promise<void> {
    this.store.set(this.key(ctx, profile.id as string), profile);
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

  private key(ctx: TenantContext, id: string): string {
    return `${ctx.tenantId}:${id}`;
  }

  async findById(ctx: TenantContext, id: string): Promise<Contact | null> {
    return this.store.get(this.key(ctx, id)) ?? null;
  }

  async save(ctx: TenantContext, contact: Contact): Promise<void> {
    this.store.set(this.key(ctx, contact.id as string), contact);
  }

  async findByAccount(ctx: TenantContext, accountId: string): Promise<Contact[]> {
    return Array.from(this.store.values()).filter(
      (c) => c.tenantId === ctx.tenantId && c.accountId === accountId,
    );
  }
}

export class InMemoryLeadRepository implements ILeadRepository {
  private readonly store = new Map<string, Lead>();

  private key(ctx: TenantContext, id: string): string {
    return `${ctx.tenantId}:${id}`;
  }

  async findById(ctx: TenantContext, id: string): Promise<Lead | null> {
    return this.store.get(this.key(ctx, id)) ?? null;
  }

  async save(ctx: TenantContext, lead: Lead): Promise<void> {
    this.store.set(this.key(ctx, lead.id as string), lead);
  }

  async findByMission(ctx: TenantContext, missionId: string): Promise<Lead[]> {
    return Array.from(this.store.values()).filter(
      (l) => l.tenantId === ctx.tenantId && l.missionId === missionId,
    );
  }

  async findQualified(ctx: TenantContext): Promise<Lead[]> {
    return Array.from(this.store.values()).filter(
      (l) => l.tenantId === ctx.tenantId && l.status === 'QUALIFIED',
    );
  }
}

export class InMemoryResearchEvidenceRepository implements IResearchEvidenceRepository {
  private readonly store = new Map<string, ResearchEvidence>();

  private key(ctx: TenantContext, id: string): string {
    return `${ctx.tenantId}:${id}`;
  }

  async save(ctx: TenantContext, evidence: ResearchEvidence): Promise<void> {
    this.store.set(this.key(ctx, evidence.evidenceId as string), evidence);
  }

  async findById(ctx: TenantContext, id: string): Promise<ResearchEvidence | null> {
    return this.store.get(this.key(ctx, id)) ?? null;
  }

  async findByAccount(ctx: TenantContext, accountId: string): Promise<ResearchEvidence[]> {
    return Array.from(this.store.values()).filter(
      (e) => e.tenantId === ctx.tenantId && e.props.accountId === accountId,
    );
  }

  async findByContact(ctx: TenantContext, contactId: string): Promise<ResearchEvidence[]> {
    return Array.from(this.store.values()).filter(
      (e) => e.tenantId === ctx.tenantId && e.props.contactId === contactId,
    );
  }

  async findByMission(ctx: TenantContext, missionId: string): Promise<ResearchEvidence[]> {
    return Array.from(this.store.values()).filter(
      (e) => e.tenantId === ctx.tenantId && e.props.missionId === missionId,
    );
  }
}
