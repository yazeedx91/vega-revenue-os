import type { TenantContext } from '@projectx/domain';
import { Actor, ICPProfile, Mission } from '@projectx/domain';
import { asAccountId, asContactId, asCorrelationId, asEventId, asICPProfileId, asICPProfileVersionId, asMissionId, asTenantId, asUserId } from '@projectx/shared';
import type { IPlanner, PlanningRequest } from '@projectx/ai-runtime';
import type { AgentContract, PlanContract } from '@projectx/shared';
import type { IWorkflowClient } from '@projectx/infrastructure';
import {
  InMemoryAccountRepository,
  InMemoryContactRepository,
  InMemoryICPProfileRepository,
  InMemoryIntelligenceAuditLog,
  InMemoryIntelligenceCache,
  InMemoryLeadRepository,
  InMemoryProviderRegistry,
  InMemoryRateLimitStore,
  InMemoryResearchEvidenceRepository,
  DynamicsIntelligenceAdapterStub,
  IntelligenceAgentExecutor,
  IntelligenceAgentRegistry,
  ResearchEngine,
  StubResearchProvider,
  type AccountCandidate,
  type BuyingSignal,
  type CompanyIntelligence,
  type ContactCandidate,
  type EnrichedContact,
} from '@projectx/intelligence';
import { MissionExecutionEngine } from '../workflow/mission-execution-engine';
import { InMemoryMissionRepository } from '../infrastructure/in-memory-mission-repository';
import { FakeEventBus } from './test-doubles';
import { InMemoryIdempotencyStore } from '../infrastructure/in-memory-idempotency-store';
import { ApprovalApplicationService } from '../application/approval-application.service';
import { InMemoryApprovalRepository } from '../infrastructure/in-memory-approval-repository';
import { InMemoryNotificationAdapter } from '../infrastructure/in-memory-notification-adapter';
import { InMemoryCompensationAdapter } from '../infrastructure/in-memory-compensation-adapter';

class ResearchPlanner implements IPlanner {
  async plan(_ctx: TenantContext, request: PlanningRequest): Promise<PlanContract> {
    const mission = request.mission;
    return {
      planId: `${mission.missionId}-plan`,
      missionId: mission.missionId,
      version: 1,
      objectives: [mission.objective],
      phases: [
        {
          phaseId: `${mission.missionId}-phase-1`,
          name: 'Research Pipeline',
          tasks: [
            {
              taskId: `${mission.missionId}-research-task`,
              missionId: mission.missionId,
              planId: `${mission.missionId}-plan`,
              agentId: 'research-orchestrator',
              agentVersion: '1.0.0',
              taskType: 'execute-research-pipeline',
              status: 'PENDING',
              input: {},
              dependsOn: [],
              approvalGateId: null,
            },
          ],
        },
      ],
      approvalGates: [],
      fallbackBranches: [],
    };
  }
}

class ResearchAgentRegistry extends IntelligenceAgentRegistry {}

function createEngine(tenantId: string) {
  const eventBus = new FakeEventBus();
  const providerRegistry = new InMemoryProviderRegistry();
  const auditLog = new InMemoryIntelligenceAuditLog();
  const rateLimit = new InMemoryRateLimitStore();
  const cache = new InMemoryIntelligenceCache();
  const businessSystemAdapter = new DynamicsIntelligenceAdapterStub();

  const icpRepo = new InMemoryICPProfileRepository();
  const accountRepo = new InMemoryAccountRepository();
  const contactRepo = new InMemoryContactRepository();
  const leadRepo = new InMemoryLeadRepository();
  const evidenceRepo = new InMemoryResearchEvidenceRepository();

  rateLimit.setQuota(tenantId, 'stub-research', 100);

  const candidates: AccountCandidate[] = [
    {
      providerAccountId: 'acc-acme',
      name: 'Acme Manufacturing',
      domain: 'acme.com',
      industry: 'Manufacturing',
      employeeCount: 500,
    },
  ];
  const companyIntel = new Map<string, CompanyIntelligence>();
  companyIntel.set('acc-acme', {
    providerAccountId: 'acc-acme',
    firmographics: { industry: 'Manufacturing', employeeCount: 500, annualRevenueUsd: 50_000_000, headquarters: 'US', territories: ['US'] },
    technographics: ['Dynamics 365'],
    signals: [],
  });
  const contacts = new Map<string, ContactCandidate[]>();
  contacts.set('acc-acme', [
    { providerContactId: 'con-jane', accountId: 'acc-acme', name: 'Jane Doe', title: 'VP Sales', email: 'jane@acme.com' },
  ]);
  const enriched = new Map<string, EnrichedContact>();
  enriched.set('con-jane', {
    providerContactId: 'con-jane',
    accountId: 'acc-acme',
    name: 'Jane Doe',
    title: 'VP Sales',
    role: 'decision-maker',
    seniority: 'VP',
    email: 'jane@acme.com',
    confidence: 0.9,
    validationStatus: 'VALID',
  });
  const signals = new Map<string, BuyingSignal[]>();
  signals.set('acc-acme', [
    { signalId: 'sig-1', signalType: 'Hiring', observedSignal: 'hiring sales reps', interpretedSignal: 'expansion', observedAt: new Date(), source: 'stub', confidence: 0.9, relevance: 0.8 },
  ]);

  providerRegistry.register(
    new StubResearchProvider({
      accounts: candidates,
      companyIntelligence: companyIntel,
      contacts,
      enrichedContacts: enriched,
      signals,
    }),
  );

  let counter = 0;
  const generate = () => {
    counter += 1;
    return `id-${counter}`;
  };

  const researchEngine = new ResearchEngine({
    icpProfileRepository: icpRepo,
    accountRepository: accountRepo,
    contactRepository: contactRepo,
    leadRepository: leadRepo,
    evidenceRepository: evidenceRepo,
    providerRegistry,
    rateLimitStore: rateLimit,
    cache,
    auditLog,
    businessSystemAdapter,
    eventBus,
    generateEventId: () => asEventId(generate()),
    generateCorrelationId: () => asCorrelationId(generate()),
    generateEvidenceId: generate,
  });

  const agentExecutor = new IntelligenceAgentExecutor(researchEngine);
  const agentRegistry = new ResearchAgentRegistry();
  const missionRepository = new InMemoryMissionRepository();
  const approvalRepository = new InMemoryApprovalRepository();
  const workflowClient = { start: async () => ({ workflowId: 'wf', tenantId: asTenantId(tenantId), correlationId: asCorrelationId('corr'), status: 'STARTED' as const }), signal: async () => {}, query: async () => undefined as any, cancel: async () => {} } as IWorkflowClient;
  const notificationPort = new InMemoryNotificationAdapter();
  const compensationPort = new InMemoryCompensationAdapter();
  const idempotencyStore = new InMemoryIdempotencyStore();

  const approvalService = new ApprovalApplicationService({
    approvalRepository,
    notificationPort,
    workflowClient,
    idempotencyStore,
    generateIdempotencyKey: (hint: string) => hint as any,
    generateEventId: () => asEventId(generate()),
    generateCorrelationId: () => asCorrelationId(generate()),
  });

  const missionEngine = new MissionExecutionEngine({
    missionRepository,
    agentExecutor,
    missionPlanner: new ResearchPlanner(),
    agentRegistry,
    approvalService,
    eventBus,
    compensationPort,
    generateEventId: () => asEventId(generate()),
    generateCorrelationId: () => asCorrelationId(generate()),
    generateIdempotencyKey: (hint: string) => hint as any,
    generateExecutionId: generate,
    defaultTaskTimeoutSeconds: 30,
    maxTaskRetries: 1,
  });

  return { missionEngine, missionRepository, leadRepo, icpRepo, eventBus };
}

async function seedMissionAndProfile(ctx: TenantContext, deps: ReturnType<typeof createEngine>) {
  const profile = ICPProfile.create(
    {
      id: asICPProfileId('icp-1'),
      versionId: asICPProfileVersionId('icp-1-v1'),
      version: 1,
      tenantId: ctx.tenantId,
      name: 'Manufacturing ICP',
      hardFilters: { industries: ['Manufacturing'], minEmployees: 50, territories: ['US'] },
      softCriteria: [{ criterion: 'uses Dynamics 365', weight: 0.2 }],
      positiveSignals: [],
      negativeSignals: [],
      disqualifiers: [],
      scoringWeights: { icpMatch: 0.4, signal: 0.25, intent: 0.15, evidenceConfidence: 0.2 },
      qualificationThreshold: 0.75,
      reviewThreshold: 0.55,
      minimumConfidence: 0.6,
    },
    ctx.correlationId as any,
    asEventId('evt-icp'),
  );
  if (!profile.success) throw new Error(profile.error.message);
  await deps.icpRepo.save(ctx, profile.value);

  const mission = Mission.create(
    {
      id: asMissionId('mission-1'),
      tenantId: ctx.tenantId,
      name: 'Research Mission',
      objective: 'find qualified prospects',
      icpId: 'icp-1',
      territory: ['US'],
      channels: ['email'],
      budget: { maxAiCostUsd: 100 },
      autonomyLevel: 0.5,
      constraints: {},
      successCriteria: { targetMeetings: 1 },
      deadline: new Date(Date.now() + 86400000),
      ownerUserId: asUserId('owner-1'),
      plan: { planId: 'mission-1-plan', version: 1, objectives: [], phases: [], approvalGates: [], fallbackBranches: [] },
    },
    ctx.correlationId as any,
    asEventId('evt-create'),
  );
  if (!mission.success) throw new Error(mission.error.message);
  const m = mission.value;
  const actor = Actor.human(asUserId('owner-1'), ctx.tenantId);
  m.approve(actor, asCorrelationId('corr-approve'), asEventId('evt-approve'));
  m.start(asCorrelationId('corr-start'), asEventId('evt-start'));
  m.clearDomainEvents();
  await deps.missionRepository.save(ctx, m);
  return m;
}

describe('Phase 11 mission integration', () => {
  it('runs research pipeline task and produces a qualified lead', async () => {
    const tenantId = asTenantId('tenant-1');
    const ctx: TenantContext = {
      tenantId,
      correlationId: asCorrelationId('corr-1'),
    };
    const deps = createEngine('tenant-1');
    await seedMissionAndProfile(ctx, deps);

    await deps.missionEngine.executeMission(ctx, 'mission-1');

    const mission = await deps.missionRepository.findById(ctx, 'mission-1');
    expect(mission?.status).toBe('COMPLETED');

    const qualified = await deps.leadRepo.findQualified(ctx);
    expect(qualified.length).toBeGreaterThanOrEqual(1);
    expect(qualified[0].status).toBe('QUALIFIED');
    expect(qualified[0].scores.overall).toBeGreaterThanOrEqual(0.75);
  });
});
