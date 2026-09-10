import type { Account, Contact, ICPProfile, Lead, ResearchEvidence, ResearchRequest, ResearchRun, Signal } from '@projectx/domain';
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
  IResearchLifecycleRepository,
  ISignalRepository,
  SignalRepositoryContext,
} from '@projectx/infrastructure';

export class InMemoryICPProfileRepository implements IICPProfileRepository {
  private readonly store = new Map<string, ICPProfile>();

  private key(ctx: ICPProfileRepositoryContext, id: string): string {
    return `${ctx.tenantId}:${ctx.workspaceId}:${id}`;
  }

  async findById(ctx: ICPProfileRepositoryContext, id: string): Promise<ICPProfile | null> {
    return this.store.get(this.key(ctx, id)) ?? null;
  }

  async findByVersionId(ctx: ICPProfileRepositoryContext, versionId: string): Promise<ICPProfile | null> {
    return (
      Array.from(this.store.values()).find(
        (p) => p.tenantId === ctx.tenantId && p.workspaceId === ctx.workspaceId && p.versionId === versionId,
      ) ?? null
    );
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

export class InMemorySignalRepository implements ISignalRepository {
  private readonly store = new Map<string, Signal>();

  private key(ctx: SignalRepositoryContext, id: string): string {
    return `${ctx.tenantId}:${ctx.workspaceId}:${id}`;
  }

  async findById(ctx: SignalRepositoryContext, id: string): Promise<Signal | null> {
    return this.store.get(this.key(ctx, id)) ?? null;
  }

  async findByDedupIdentity(ctx: SignalRepositoryContext, dedupIdentity: string): Promise<Signal | null> {
    return Array.from(this.store.values()).find(
      (signal) => signal.tenantId === ctx.tenantId && signal.workspaceId === ctx.workspaceId && signal.dedupIdentity === dedupIdentity,
    ) ?? null;
  }

  async save(ctx: SignalRepositoryContext, signal: Signal): Promise<void> {
    this.store.set(this.key(ctx, signal.id), signal);
  }

  async findActiveByAccount(ctx: SignalRepositoryContext, accountId: string, evaluatedAt: Date): Promise<Signal[]> {
    return Array.from(this.store.values()).filter(
      (signal) => signal.tenantId === ctx.tenantId && signal.workspaceId === ctx.workspaceId
        && signal.accountId === accountId && signal.isActive(evaluatedAt),
    );
  }
}

export class InMemoryResearchLifecycleRepository implements IResearchLifecycleRepository {
  private readonly requests = new Map<string, ResearchRequest>();
  private readonly runs = new Map<string, ResearchRun>();

  private key(ctx: ResearchEvidenceRepositoryContext, id: string): string {
    return `${ctx.tenantId}:${ctx.workspaceId}:${id}`;
  }

  async saveRequest(ctx: ResearchEvidenceRepositoryContext, request: ResearchRequest): Promise<void> {
    this.requests.set(this.key(ctx, request.id), request);
  }

  async findRequest(ctx: ResearchEvidenceRepositoryContext, requestId: string): Promise<ResearchRequest | null> {
    return this.requests.get(this.key(ctx, requestId)) ?? null;
  }

  async saveRun(ctx: ResearchEvidenceRepositoryContext, run: ResearchRun): Promise<void> {
    this.runs.set(this.key(ctx, run.id), run);
  }

  async findRun(ctx: ResearchEvidenceRepositoryContext, runId: string): Promise<ResearchRun | null> {
    return this.runs.get(this.key(ctx, runId)) ?? null;
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
