import {
  Account,
  Contact,
  Lead,
  ResearchEvidence,
  ResearchRequest,
  ResearchRun,
  type AccountId,
  type ContactId,
  type ICPProfile,
  type LeadId,
  type ResearchEvidenceProps,
  type TenantContext,
} from '@projectx/domain';
import { asAccountId, asContactId, asEvidenceId, asLeadId, type CorrelationId, type EventId, type ResearchRequestId, type ResearchRunId } from '@projectx/shared';
import type { JsonValue } from '@projectx/domain';
import type { IEventBus } from '@projectx/infrastructure';
import type {
  IAccountRepository,
  IContactRepository,
  IICPProfileRepository,
  ILeadRepository,
  IResearchEvidenceRepository,
} from '@projectx/infrastructure';
import type { IIntelligenceAuditLog } from '../ports/intelligence-audit-log.interface';
import type { IIntelligenceCache } from '../ports/intelligence-cache.interface';
import type { IProviderRegistry } from '../ports/provider-registry.interface';
import type { IRateLimitStore } from '../ports/rate-limit.interface';
import type {
  AccountCandidate,
  BuyingSignal,
  CompanyIntelligence,
  ContactCandidate,
  EnrichedContact,
  IResearchProvider,
} from '../ports/research-provider.interface';
import type { IBusinessSystemIntelligenceAdapter } from '../ports/business-system-intelligence.interface';
import { ICPScorer, SignalScorer, LeadScorer, computeEvidenceConfidence } from './scoring';

export interface ResearchEngineDependencies {
  icpProfileRepository: IICPProfileRepository;
  accountRepository: IAccountRepository;
  contactRepository: IContactRepository;
  leadRepository: ILeadRepository;
  evidenceRepository: IResearchEvidenceRepository;
  providerRegistry: IProviderRegistry;
  rateLimitStore: IRateLimitStore;
  cache: IIntelligenceCache;
  auditLog: IIntelligenceAuditLog;
  businessSystemAdapter: IBusinessSystemIntelligenceAdapter;
  eventBus: IEventBus;
  generateEventId: () => EventId;
  generateCorrelationId: () => CorrelationId;
  generateEvidenceId: () => string;
  generateRequestId: () => ResearchRequestId;
  generateRunId: () => ResearchRunId;
  computeQueryHash: (input: { icpProfileId: string; territories?: string[]; maxResults?: number; objective: string }) => string;
  computeEvidenceFingerprint: (input: { claimType: string; normalizedValue: JsonValue; source: string }) => string;
}

export interface ResearchRunRequest {
  missionId: string;
  workspaceId: string;
  icpProfileId: string;
  objective: string;
  territories?: string[];
  maxResults?: number;
}

export interface ResearchRunResult {
  accountsDiscovered: number;
  contactsDiscovered: number;
  leadsQualified: number;
  leadsNeedReview: number;
}

export class ResearchEngine {
  constructor(private readonly deps: ResearchEngineDependencies) {}

  async run(ctx: TenantContext, request: ResearchRunRequest): Promise<ResearchRunResult> {
    const profile = await this.deps.icpProfileRepository.findById(ctx, request.icpProfileId);
    if (!profile) {
      throw new Error(`ICP profile ${request.icpProfileId} not found`);
    }

    const provider = await this.selectProvider(ctx);
    if (!provider) {
      throw new Error('No research provider available');
    }

    const queryHash = this.deps.computeQueryHash({
      icpProfileId: request.icpProfileId,
      territories: request.territories,
      maxResults: request.maxResults,
      objective: request.objective,
    });
    const now = new Date().toISOString();
    const researchRequest = ResearchRequest.create({
      id: this.deps.generateRequestId(),
      tenantId: ctx.tenantId,
      workspaceId: request.workspaceId,
      missionId: request.missionId,
      queryHash,
      requestedAt: now,
    });
    const researchRun = ResearchRun.create({
      id: this.deps.generateRunId(),
      tenantId: ctx.tenantId,
      workspaceId: request.workspaceId,
      requestId: researchRequest.id,
    });
    researchRun.start(now);

    const summary: ResearchRunResult = {
      accountsDiscovered: 0,
      contactsDiscovered: 0,
      leadsQualified: 0,
      leadsNeedReview: 0,
    };

    try {
      const accountCandidates = await this.discoverAccounts(ctx, provider, request, profile);

      for (const candidate of accountCandidates) {
        const account = await this.processAccount(ctx, provider, candidate, request.workspaceId, researchRequest.id, researchRun.id);
        if (!account || account.status === 'DUPLICATE' || account.status === 'DISQUALIFIED') {
          continue;
        }
        summary.accountsDiscovered += 1;

        const contacts = await this.processContacts(ctx, provider, account, researchRequest.id, researchRun.id);
        summary.contactsDiscovered += contacts.length;

        for (const contact of contacts) {
          await this.evaluateLead(ctx, account, contact, profile);
        }
      }

      summary.leadsQualified = (await this.deps.leadRepository.findQualified(ctx)).length;
      summary.leadsNeedReview = (await this.deps.leadRepository.findByMission(ctx, request.missionId)).filter(
        (l) => l.status === 'NEEDS_REVIEW',
      ).length;

      researchRun.succeed(new Date().toISOString());
    } catch (error) {
      researchRun.fail('RESEARCH_RUN_FAILED', 'Research run encountered an error during execution', new Date().toISOString());
      throw error;
    }

    return summary;
  }

  private async selectProvider(ctx: TenantContext): Promise<IResearchProvider | null> {
    return this.deps.providerRegistry.select(ctx, { capability: 'discover-accounts' });
  }

  private async discoverAccounts(
    ctx: TenantContext,
    provider: IResearchProvider,
    request: ResearchRunRequest,
    profile: ICPProfile,
  ): Promise<AccountCandidate[]> {
    const cacheKey = `accounts:${request.icpProfileId}:${(request.territories ?? []).join(',')}:${request.maxResults ?? 10}`;
    const cached = await this.deps.cache.get<AccountCandidate[]>(ctx, cacheKey);
    if (cached) {
      await this.deps.auditLog.record(ctx, { action: 'CACHE_HIT', result: 'SUCCESS', missionId: request.missionId });
      return cached.value;
    }

    await this.checkRateLimit(ctx, provider.providerId, 1);
    const candidates = await provider.discoverAccounts(ctx, {
      icpProfileId: request.icpProfileId,
      territories: request.territories,
      industries: profile.hardFilters.industries,
      maxResults: request.maxResults ?? 10,
    });
    await this.deps.cache.set<AccountCandidate[]>(ctx, cacheKey, {
      value: candidates,
      cachedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      providerId: provider.providerId,
      queryHash: cacheKey,
    });
    await this.deps.auditLog.record(ctx, {
      action: 'DISCOVER_ACCOUNTS',
      providerId: provider.providerId,
      result: 'SUCCESS',
      missionId: request.missionId,
      costUsd: 0.5,
    });
    return candidates;
  }

  private async processAccount(
    ctx: TenantContext,
    provider: IResearchProvider,
    candidate: AccountCandidate,
    workspaceId: string,
    requestId: ResearchRequestId,
    runId: ResearchRunId,
  ): Promise<Account | null> {
    const duplicate = await this.deps.businessSystemAdapter.findDuplicateAccount(ctx, candidate);
    if (duplicate) {
      const account = Account.create(
        {
          id: asAccountId(candidate.providerAccountId),
          tenantId: ctx.tenantId,
          workspaceId,
          name: candidate.name,
          domain: candidate.domain,
          industry: candidate.industry,
          employeeCount: candidate.employeeCount,
          annualRevenueUsd: candidate.annualRevenueUsd,
        },
        this.deps.generateCorrelationId(),
        this.deps.generateEventId(),
      );
      account.markDuplicate(asAccountId(duplicate.accountId), 'Business system duplicate', this.deps.generateCorrelationId(), this.deps.generateEventId());
      await this.deps.accountRepository.save(ctx, account);
      await this.publishEvents(account);
      return account;
    }

    const intelligence = await this.getCompanyIntelligence(ctx, provider, candidate.providerAccountId);
    const evidenceIds: string[] = [];
    for (const claim of this.extractAccountClaims(candidate, intelligence)) {
      const evidence = this.createEvidence(ctx, claim, candidate.providerAccountId, workspaceId, requestId, runId);
      await this.deps.evidenceRepository.save(ctx, evidence);
      evidenceIds.push(evidence.evidenceId as string);
    }

    const account = Account.create(
      {
        id: asAccountId(candidate.providerAccountId),
        tenantId: ctx.tenantId,
        workspaceId,
        name: candidate.name,
        domain: candidate.domain,
        industry: candidate.industry,
        employeeCount: candidate.employeeCount ?? intelligence.firmographics.employeeCount,
        annualRevenueUsd: candidate.annualRevenueUsd ?? intelligence.firmographics.annualRevenueUsd,
        territories: intelligence.firmographics.territories,
        techStack: intelligence.technographics,
        evidenceReferences: evidenceIds as any,
      },
      this.deps.generateCorrelationId(),
      this.deps.generateEventId(),
    );
    account.enrich({}, evidenceIds as any, this.deps.generateCorrelationId(), this.deps.generateEventId());
    await this.deps.accountRepository.save(ctx, account);
    await this.publishEvents(account);
    return account;
  }

  private async getCompanyIntelligence(
    ctx: TenantContext,
    provider: IResearchProvider,
    providerAccountId: string,
  ): Promise<CompanyIntelligence> {
    const cacheKey = `intelligence:${providerAccountId}`;
    const cached = await this.deps.cache.get<CompanyIntelligence>(ctx, cacheKey);
    if (cached) return cached.value;
    await this.checkRateLimit(ctx, provider.providerId, 1);
    const intelligence = await provider.getCompanyIntelligence(ctx, providerAccountId);
    await this.deps.cache.set<CompanyIntelligence>(ctx, cacheKey, {
      value: intelligence,
      cachedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      providerId: provider.providerId,
      queryHash: cacheKey,
    });
    await this.deps.auditLog.record(ctx, { action: 'GET_COMPANY_INTELLIGENCE', providerId: provider.providerId, result: 'SUCCESS' });
    return intelligence;
  }

  private extractAccountClaims(
    candidate: AccountCandidate,
    intelligence: CompanyIntelligence,
  ): Array<{ claimType: string; normalizedValue: unknown; source: string; confidence: number }> {
    return [
      { claimType: 'EMPLOYEE_COUNT', normalizedValue: intelligence.firmographics.employeeCount ?? candidate.employeeCount, source: 'provider', confidence: 0.8 },
      { claimType: 'INDUSTRY', normalizedValue: candidate.industry ?? intelligence.firmographics.industry, source: 'provider', confidence: 0.85 },
      { claimType: 'ANNUAL_REVENUE', normalizedValue: candidate.annualRevenueUsd ?? intelligence.firmographics.annualRevenueUsd, source: 'provider', confidence: 0.7 },
    ].filter((c) => c.normalizedValue !== undefined && c.normalizedValue !== null);
  }

  private createEvidence(
    ctx: TenantContext,
    claim: { claimType: string; normalizedValue: unknown; source: string; confidence: number },
    accountId: string,
    workspaceId: string,
    requestId: ResearchRequestId,
    runId: ResearchRunId,
    missionId?: string,
  ): ResearchEvidence {
    const normalizedValue = (claim.normalizedValue ?? null) as JsonValue;
    const now = new Date().toISOString();
    const fingerprint = this.deps.computeEvidenceFingerprint({
      claimType: claim.claimType,
      normalizedValue,
      source: claim.source,
    });
    return new ResearchEvidence({
      evidenceId: asEvidenceId(this.deps.generateEvidenceId()),
      tenantId: ctx.tenantId,
      workspaceId,
      requestId,
      runId,
      accountId: asAccountId(accountId),
      missionId,
      claimType: claim.claimType,
      normalizedValue,
      source: claim.source,
      reliabilityTier: 'PREMIUM_PROVIDER',
      observedAt: now,
      freshnessExpiry: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      confidence: claim.confidence,
      confidenceBreakdown: { sourceReliability: 0.8, extractionConfidence: claim.confidence, corroboration: 0 },
      provenance: [
        { step: 'provider-extract', inputSummary: claim.claimType, outputSummary: JSON.stringify(claim.normalizedValue), occurredAt: now },
      ],
      evidenceFingerprint: fingerprint,
    });
  }

  private async processContacts(ctx: TenantContext, provider: IResearchProvider, account: Account, requestId: ResearchRequestId, runId: ResearchRunId): Promise<Contact[]> {
    const contacts: Contact[] = [];
    const candidates = await this.discoverContacts(ctx, provider, account.id as string);
    for (const candidate of candidates) {
      const duplicate = await this.deps.businessSystemAdapter.findDuplicateContact(ctx, candidate);
      if (duplicate) continue;

      const enriched = await this.enrichContact(ctx, provider, candidate);
      const evidence = this.createEvidence(
        ctx,
        { claimType: 'CONTACT_ROLE', normalizedValue: enriched.role ?? enriched.title, source: 'provider', confidence: enriched.confidence },
        account.id as string,
        account.workspaceId,
        requestId,
        runId,
      );
      await this.deps.evidenceRepository.save(ctx, evidence);

      const contact = Contact.discover(
        {
          id: asContactId(candidate.providerContactId),
          tenantId: ctx.tenantId,
          workspaceId: account.workspaceId,
          accountId: account.id as AccountId,
          name: enriched.name,
          title: enriched.title,
          role: enriched.role,
          seniority: enriched.seniority,
          channels: enriched.channels,
          evidenceReferences: [evidence.evidenceId as string] as any,
        },
        'provider',
        this.deps.generateCorrelationId(),
        this.deps.generateEventId(),
      );
      contact.enrich({}, [evidence.evidenceId as string] as any, this.deps.generateCorrelationId(), this.deps.generateEventId());
      if (enriched.validationStatus === 'VALID') {
        contact.validate(this.deps.generateCorrelationId(), this.deps.generateEventId());
      }
      await this.deps.contactRepository.save(ctx, contact);
      await this.publishEvents(contact);
      contacts.push(contact);
    }
    return contacts;
  }

  private async discoverContacts(ctx: TenantContext, provider: IResearchProvider, accountId: string): Promise<ContactCandidate[]> {
    const cacheKey = `contacts:${accountId}`;
    const cached = await this.deps.cache.get<ContactCandidate[]>(ctx, cacheKey);
    if (cached) return cached.value;
    await this.checkRateLimit(ctx, provider.providerId, 1);
    const candidates = await provider.discoverContacts(ctx, accountId);
    await this.deps.cache.set<ContactCandidate[]>(ctx, cacheKey, {
      value: candidates,
      cachedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      providerId: provider.providerId,
      queryHash: cacheKey,
    });
    await this.deps.auditLog.record(ctx, { action: 'DISCOVER_CONTACTS', providerId: provider.providerId, result: 'SUCCESS' });
    return candidates;
  }

  private async enrichContact(ctx: TenantContext, provider: IResearchProvider, candidate: ContactCandidate): Promise<EnrichedContact> {
    const cacheKey = `enriched-contact:${candidate.providerContactId}`;
    const cached = await this.deps.cache.get<EnrichedContact>(ctx, cacheKey);
    if (cached) return cached.value;
    await this.checkRateLimit(ctx, provider.providerId, 1);
    const enriched = await provider.enrichContact(ctx, candidate);
    await this.deps.cache.set<EnrichedContact>(ctx, cacheKey, {
      value: enriched,
      cachedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      providerId: provider.providerId,
      queryHash: cacheKey,
    });
    await this.deps.auditLog.record(ctx, { action: 'ENRICH_CONTACT', providerId: provider.providerId, result: 'SUCCESS', costUsd: 0.2 });
    return enriched;
  }

  private async evaluateLead(ctx: TenantContext, account: Account, contact: Contact, profile: ICPProfile): Promise<void> {
    const signals = await this.detectSignalsForAccount(ctx, account);
    const icpResult = new ICPScorer().score(account, profile);
    const signalScore = new SignalScorer().score(signals.map((s) => ({ relevance: s.relevance, confidence: s.confidence })));

    const evidence = await this.deps.evidenceRepository.findByAccount(ctx, account.id as string);
    const evidenceConfidence = computeEvidenceConfidence(
      evidence.map((e) => ({ confidence: e.confidence, isFresh: e.isFresh() })),
    );

    const scores = new LeadScorer().score(
      icpResult.score,
      signalScore,
      evidenceConfidence,
      profile.scoringWeights,
    );

    const lead = Lead.create(
      {
        id: asLeadId(`lead-${account.id as string}-${contact.id as string}`),
        tenantId: ctx.tenantId,
        workspaceId: account.workspaceId,
        missionId: undefined,
        accountId: account.id as AccountId,
        contactId: contact.id as ContactId,
        icpProfileId: profile.id,
        icpProfileVersionId: profile.versionId,
      },
      this.deps.generateCorrelationId(),
      this.deps.generateEventId(),
    );

    const hardFilterResults = this.deriveHardFilterResults(icpResult);

    lead.evaluate(
      {
        scores,
        qualificationThreshold: profile.qualificationThreshold,
        reviewThreshold: profile.reviewThreshold,
        hardFilterResults,
        evidenceIds: evidence.map((e) => e.evidenceId) as any,
        signalIds: [],
        normalizedFeatures: {
          industry: account.industry ?? null,
          employeeCount: account.employeeCount ?? null,
          territories: account.territories ?? [],
        } as any,
        snapshotSchemaVersion: '1.0',
        scoringPolicyVersion: '1.0',
        algorithmVersion: '1.0',
        evaluatedAt: new Date(),
      },
      this.deps.generateCorrelationId(),
      this.deps.generateEventId(),
    );

    await this.deps.leadRepository.save(ctx, lead);
    await this.publishEvents(lead);
  }

  private deriveHardFilterResults(icpResult: { passed: boolean; reasons: string[] }): Array<{ filter: 'INDUSTRY' | 'GEOGRAPHY' | 'COMPANY_SIZE' | 'TERRITORY' | 'EXCLUDED_INDUSTRY'; passed: boolean }> {
    if (icpResult.passed) return [];
    const results: Array<{ filter: 'INDUSTRY' | 'GEOGRAPHY' | 'COMPANY_SIZE' | 'TERRITORY' | 'EXCLUDED_INDUSTRY'; passed: boolean }> = [];
    for (const reason of icpResult.reasons) {
      const lower = reason.toLowerCase();
      if (lower.includes('industry')) {
        results.push({ filter: 'INDUSTRY', passed: false });
      } else if (lower.includes('territory')) {
        results.push({ filter: 'TERRITORY', passed: false });
      } else if (lower.includes('employee')) {
        results.push({ filter: 'COMPANY_SIZE', passed: false });
      } else {
        results.push({ filter: 'INDUSTRY', passed: false });
      }
    }
    return results;
  }

  private async detectSignalsForAccount(ctx: TenantContext, account: Account): Promise<Array<{ relevance: number; confidence: number }>> {
    const provider = await this.deps.providerRegistry.select(ctx, { capability: 'detect-signals' });
    if (!provider) return [];
    const cacheKey = `signals:${account.id as string}`;
    const cached = await this.deps.cache.get<BuyingSignal[]>(ctx, cacheKey);
    let signals: BuyingSignal[];
    if (cached) {
      signals = cached.value;
    } else {
      await this.checkRateLimit(ctx, provider.providerId, 1);
      signals = await provider.detectSignals(ctx, account.id as string);
      await this.deps.cache.set<BuyingSignal[]>(ctx, cacheKey, {
        value: signals,
        cachedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        providerId: provider.providerId,
        queryHash: cacheKey,
      });
      await this.deps.auditLog.record(ctx, { action: 'DETECT_SIGNALS', providerId: provider.providerId, result: 'SUCCESS' });
    }
    return signals.map((s) => ({ relevance: s.relevance, confidence: s.confidence }));
  }

  private async checkRateLimit(ctx: TenantContext, providerId: string, cost: number): Promise<void> {
    const info = await this.deps.rateLimitStore.check(ctx, providerId, cost);
    if (!info.allowed) {
      await this.deps.auditLog.record(ctx, { action: 'DISCOVER_ACCOUNTS', providerId, result: 'RATE_LIMITED' });
      throw new Error(`Rate limit exceeded for provider ${providerId}`);
    }
    await this.deps.rateLimitStore.recordUsage(ctx, providerId, cost);
  }

  private async publishEvents(aggregate: Account | Contact | Lead): Promise<void> {
    for (const event of aggregate.domainEvents) {
      await this.deps.eventBus.publish(event);
    }
    aggregate.clearDomainEvents();
  }
}
