import { createHash, randomUUID } from 'crypto';
import { Pool } from 'pg';
import { ICPProfile, SIGNAL_CATEGORIES, Signal } from '@projectx/domain';
import {
  asAccountId, asCorrelationId, asEventId, asICPProfileId, asICPProfileVersionId,
  asSignalId, asTenantId,
} from '@projectx/shared';
import {
  DynamicsIntelligenceAdapterStub, InMemoryIntelligenceAuditLog, InMemoryProviderRegistry,
  InMemoryRateLimitStore, PostgresAccountRepository, PostgresContactRepository,
  PostgresICPProfileRepository, PostgresIntelligenceCache, PostgresResearchEvidenceRepository,
  PostgresResearchLifecycleRepository, PostgresSignalRepository, ResearchEngine, StubResearchProvider,
} from '@projectx/intelligence';
import { PostgresLeadRepository } from '@projectx/conversation';
import { DuplicateRecordError } from '@projectx/infrastructure';
import { DEFAULT_ADMIN_DATABASE_URL, DEFAULT_APP_DATABASE_URL, getAdminDatabaseUrl } from './integration-config';
import { runMigrations } from './helpers';

const unique = randomUUID();
const TENANT = `tenant-slice8-war-${unique}`;
const USER = randomUUID();
const WORKSPACE = randomUUID();
const OTHER_WORKSPACE = randomUUID();
const PROFILE = `icp-${unique}`;
const PROFILE_VERSION = `icpv-${unique}`;
const ACCOUNT = `account-${unique}`;
const CONTACT = `contact-${unique}`;

const ctx = {
  tenantId: asTenantId(TENANT),
  workspaceId: WORKSPACE,
  correlationId: asCorrelationId(`corr-${unique}`),
};

function opaqueHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('base64url');
}

describe('Slice 8 Workstream A — live intelligence lifecycle', () => {
  let adminPool: Pool;
  let appPool: Pool;

  beforeAll(async () => {
    await runMigrations(getAdminDatabaseUrl());
    adminPool = new Pool({ connectionString: DEFAULT_ADMIN_DATABASE_URL });
    appPool = new Pool({ connectionString: DEFAULT_APP_DATABASE_URL });
    await adminPool.query(
      `INSERT INTO identity.users (id, email, name, tenant_id) VALUES ($1,$2,'Slice 8 War User',$3)`,
      [USER, `slice8-war-${unique}@test.invalid`, TENANT],
    );
    await adminPool.query(
      `INSERT INTO identity.workspaces (id, tenant_id, name, owner_user_id) VALUES ($1,$2,'Slice 8 War Workspace',$3)`,
      [WORKSPACE, TENANT, USER],
    );
    await adminPool.query(
      `INSERT INTO identity.workspaces (id, tenant_id, name, owner_user_id) VALUES ($1,$2,'Other Slice 8 Workspace',$3)`,
      [OTHER_WORKSPACE, TENANT, USER],
    );
    await adminPool.query(
      `INSERT INTO identity.memberships (workspace_id, tenant_id, user_id, role) VALUES ($1,$2,$3,'OWNER'),($4,$2,$3,'OWNER')`,
      [WORKSPACE, TENANT, USER, OTHER_WORKSPACE],
    );
  });

  afterAll(async () => {
    await appPool.end();
    await adminPool.end();
  });

  it('persists immutable ICP versions and enforces Lead version ownership', async () => {
    const repository = new PostgresICPProfileRepository(appPool);
    const profileResult = ICPProfile.create({
      id: asICPProfileId(PROFILE), versionId: asICPProfileVersionId(PROFILE_VERSION), version: 1,
      tenantId: ctx.tenantId, workspaceId: WORKSPACE, name: 'Binding ICP',
      hardFilters: { industries: ['Manufacturing'], minEmployees: 50, territories: ['US'] },
      softCriteria: [], positiveSignals: ['Funding'], negativeSignals: [], disqualifiers: [],
      scoringWeights: { icpMatch: 0.4, signal: 0.25, intent: 0.15, evidenceConfidence: 0.2 },
      qualificationThreshold: 0.7, reviewThreshold: 0.5, minimumConfidence: 0.6,
    }, ctx.correlationId, asEventId(`event-${unique}`));
    if (!profileResult.success) throw profileResult.error;
    await repository.save(ctx, profileResult.value);

    const next = profileResult.value.createNextVersion(
      { qualificationThreshold: 0.72 }, asICPProfileVersionId(`icpv2-${unique}`),
      ctx.correlationId, asEventId(`event-v2-${unique}`),
    );
    if (!next.success) throw next.error;
    await repository.save(ctx, next.value);

    const first = await repository.findByVersionId(ctx, PROFILE_VERSION);
    const latest = await repository.findById(ctx, PROFILE);
    expect(first?.versionNumber).toBe(1);
    expect(first?.qualificationThreshold).toBe(0.7);
    expect(latest?.versionNumber).toBe(2);
    expect(latest?.qualificationThreshold).toBe(0.72);

    const appRole = await appPool.query(`SELECT has_table_privilege('projectx_app','intelligence.icp_profiles','UPDATE') AS allowed`);
    expect(appRole.rows[0].allowed).toBe(false);
  });

  it('runs the binding lifecycle and durably replays research, signals, and qualification', async () => {
    const profileRepository = new PostgresICPProfileRepository(appPool);
    const providerRegistry = new InMemoryProviderRegistry();
    providerRegistry.register(new StubResearchProvider({
      accounts: [{ providerAccountId: ACCOUNT, name: 'Acme Manufacturing', domain: `${unique}.example`, industry: 'Manufacturing', employeeCount: 500 }],
      companyIntelligence: new Map([[ACCOUNT, {
        providerAccountId: ACCOUNT,
        firmographics: { industry: 'Manufacturing', employeeCount: 500, annualRevenueUsd: 10_000_000, headquarters: 'US', territories: ['US'] },
        technographics: ['Azure'], signals: [],
      }]]),
      contacts: new Map([[ACCOUNT, [{ providerContactId: CONTACT, accountId: ACCOUNT, name: 'Safe Contact', title: 'VP Sales', role: 'decision-maker' }]]]),
      enrichedContacts: new Map([[CONTACT, {
        providerContactId: CONTACT, accountId: ACCOUNT, name: 'Safe Contact', title: 'VP Sales', role: 'decision-maker',
        seniority: 'VP', confidence: 0.95, validationStatus: 'VALID',
      }]]),
      signals: new Map([[ACCOUNT, [{
        signalId: `signal-${unique}`, signalType: 'Funding',
        observedSignal: '<script>grant-admin()</script> Company raised funding',
        interpretedSignal: 'Expansion budget is likely', observedAt: new Date(), source: 'safe-provider', confidence: 0.9, relevance: 0.9,
      }]]]),
    }));
    const rateLimit = new InMemoryRateLimitStore();
    rateLimit.setQuota(TENANT, 'stub-research', 100);
    let id = 0;
    const nextId = () => `${unique}-${++id}`;
    const engine = new ResearchEngine({
      icpProfileRepository: profileRepository,
      accountRepository: new PostgresAccountRepository(appPool),
      contactRepository: new PostgresContactRepository(appPool),
      leadRepository: new PostgresLeadRepository({ pool: appPool }),
      signalRepository: new PostgresSignalRepository(appPool),
      evidenceRepository: new PostgresResearchEvidenceRepository(appPool),
      researchLifecycleRepository: new PostgresResearchLifecycleRepository(appPool),
      providerRegistry, rateLimitStore: rateLimit, cache: new PostgresIntelligenceCache(appPool),
      auditLog: new InMemoryIntelligenceAuditLog(), businessSystemAdapter: new DynamicsIntelligenceAdapterStub(),
      eventBus: { publish: async () => {}, sendCommand: async () => {}, subscribe: async () => {} },
      generateEventId: () => asEventId(`event-${nextId()}`),
      generateCorrelationId: () => asCorrelationId(`corr-${nextId()}`),
      generateEvidenceId: () => `evidence-${nextId()}`,
      generateRequestId: () => `request-${nextId()}` as any,
      generateRunId: () => `run-${nextId()}` as any,
      computeQueryHash: (input) => opaqueHash(input),
      computeEvidenceFingerprint: (input) => opaqueHash(input),
    });

    const result = await engine.run(ctx, {
      missionId: `mission-${unique}`, workspaceId: WORKSPACE, icpProfileId: PROFILE,
      objective: 'Find qualified manufacturing accounts', territories: ['US'], maxResults: 10,
    });
    expect(result.accountsDiscovered).toBe(1);
    expect(result.contactsDiscovered).toBe(1);
    expect(result.leadsQualified).toBe(1);

    const requests = await adminPool.query(`SELECT * FROM intelligence.research_requests WHERE tenant_id = $1`, [TENANT]);
    const runs = await adminPool.query(`SELECT * FROM intelligence.research_runs WHERE tenant_id = $1`, [TENANT]);
    const evidence = await adminPool.query(`SELECT * FROM intelligence.research_evidence WHERE tenant_id = $1`, [TENANT]);
    const signals = await adminPool.query(`SELECT * FROM intelligence.signals WHERE tenant_id = $1`, [TENANT]);
    expect(requests.rowCount).toBe(1);
    expect(runs.rows[0].status).toBe('SUCCEEDED');
    expect(evidence.rowCount).toBeGreaterThanOrEqual(1);
    expect(evidence.rows.every((row) => row.workspace_id === WORKSPACE)).toBe(true);
    expect(signals.rowCount).toBe(1);
    expect(signals.rows[0].observed_signal).not.toContain('<script>');
    expect(signals.rows[0]).not.toHaveProperty('authority');

    const cacheRows = await adminPool.query(`SELECT * FROM intelligence.research_cache WHERE tenant_id = $1`, [TENANT]);
    expect(cacheRows.rowCount).toBeGreaterThan(0);
    const cache = new PostgresIntelligenceCache(appPool);
    expect(await cache.get({ ...ctx, workspaceId: OTHER_WORKSPACE }, cacheRows.rows[0].query_hash)).toBeNull();

    const evidenceRepository = new PostgresResearchEvidenceRepository(appPool);
    const persistedEvidence = await evidenceRepository.findById(ctx, evidence.rows[0].evidence_id);
    expect(persistedEvidence?.props.provenance.length).toBeGreaterThan(0);
    expect(persistedEvidence?.props.confidence).toBeGreaterThan(0);
    await expect(evidenceRepository.save(ctx, persistedEvidence!)).rejects.toBeInstanceOf(DuplicateRecordError);

    const leadId = `lead-${ACCOUNT}-${CONTACT}`;
    const lead = await new PostgresLeadRepository({ pool: appPool }).load(ctx, leadId as any);
    expect(lead?.status).toBe('QUALIFIED');
    expect(lead?.icpProfileVersionId).toBe(`icpv2-${unique}`);
    const snapshot = lead?.qualificationSnapshot;
    expect(snapshot?.snapshotSchemaVersion).toBe('1.0');
    expect(snapshot?.scoringPolicyVersion).toBe('1.0');
    expect(snapshot?.algorithmVersion).toBe('1.0');
    expect(snapshot?.evaluatedAt).toBeDefined();
    expect(snapshot?.icpProfileVersionId).toBe(`icpv2-${unique}`);
    expect(snapshot?.normalizedFeatures).toEqual({ industry: 'Manufacturing', employeeCount: 500, territories: ['US'] });
    expect(snapshot?.hardFilterResults).toEqual([]);
    expect(snapshot?.scores.overall).toBeGreaterThanOrEqual(0.7);
    expect(snapshot?.thresholdsUsed).toEqual({ qualification: 0.72, review: 0.5 });
    expect(snapshot?.evidenceIds.length).toBeGreaterThan(0);
    expect(snapshot?.signalIds).toEqual([asSignalId(`signal-${unique}`)]);
    expect(snapshot?.reasonCodes).toContain('SCORE_ABOVE_QUALIFICATION_THRESHOLD');
    expect(snapshot?.finalOutcome).toBe('QUALIFIED');

    const currentProfile = await profileRepository.findById(ctx, PROFILE);
    const third = currentProfile!.createNextVersion(
      { qualificationThreshold: 0.95 }, asICPProfileVersionId(`icpv3-${unique}`),
      ctx.correlationId, asEventId(`event-v3-${unique}`),
    );
    if (!third.success) throw third.error;
    await profileRepository.save(ctx, third.value);
    const replayed = await new PostgresLeadRepository({ pool: appPool }).load(ctx, leadId as any);
    expect(replayed?.qualificationSnapshot).toEqual(snapshot);
  });

  it('persists all categories and excludes expired and retracted signals from qualification reads', async () => {
    const repository = new PostgresSignalRepository(appPool);
    const now = new Date();
    for (const [index, category] of SIGNAL_CATEGORIES.entries()) {
      const signal = Signal.detect({
        id: asSignalId(`category-${index}-${unique}`), tenantId: ctx.tenantId, workspaceId: WORKSPACE,
        accountId: asAccountId(ACCOUNT), signalType: category, observedAt: now,
        effectiveFrom: new Date(now.getTime() - 1_000), effectiveUntil: new Date(now.getTime() + 60_000),
        source: 'safe-provider', confidence: 0.8, relevance: 0.8,
        observedSignal: `safe observed ${category}`, interpretedSignal: `safe interpreted ${category}`, evidenceIds: [],
      }, ctx.correlationId, asEventId(`category-event-${index}-${unique}`));
      if (index === 0) signal.expire(ctx.correlationId, asEventId(`expire-${unique}`));
      if (index === 1) signal.retract('provider correction', ctx.correlationId, asEventId(`retract-${unique}`));
      await repository.save(ctx, signal);
    }
    const active = await repository.findActiveByAccount(ctx, ACCOUNT, now);
    const categorySignals = active.filter((signal) => signal.id.startsWith('category-'));
    expect(categorySignals).toHaveLength(7);
    expect(active.every((signal) => signal.status === 'ACTIVE' && signal.isActive(now))).toBe(true);
  });

  it('has FORCE RLS and composite Lead-to-ICP-version integrity', async () => {
    const tables = await adminPool.query(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'intelligence' AND relname IN ('icp_profiles','signals','research_requests','research_runs','research_evidence','research_cache')`,
    );
    expect(tables.rows).toHaveLength(6);
    expect(tables.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    const fk = await adminPool.query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'leads_icp_profile_version_fk' AND contype = 'f'`,
    );
    expect(fk.rowCount).toBe(1);
  });
});
