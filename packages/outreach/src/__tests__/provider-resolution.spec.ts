import type { Lead, OutreachPlan, ProviderSendRequest, ProviderSendResult, TenantContext } from '@projectx/domain';
import { ResearchEvidence } from '@projectx/domain';
import type { IOutboundRecipientSource } from '../ports/outbound-recipient-source.interface';
import type {
  IHistoricalRecipientFingerprint,
  IOutboundRecipientRecovery,
} from '../ports/outbound-recipient-recovery.interface';
import { InMemoryAuditLog, InMemoryIdempotencyStore, InMemoryRateLimiter } from '@projectx/infrastructure';
import {
  asAccountId,
  asCampaignId,
  asContactId,
  asCorrelationId,
  asEvidenceId,
  asICPProfileId,
  asIdempotencyKey,
  asLeadId,
  asOutreachMessageId,
  asSequenceId,
  asResearchRequestId,
  asResearchRunId,
  asTenantId,
} from '@projectx/shared';
import { OutreachExecutionService } from '../application/outreach-execution.service';
import { OutreachPersonalizationService } from '../application/outreach-personalization.service';
import { OutreachPlanningService } from '../application/outreach-planning.service';
import { InMemoryApprovalVerificationPort } from '../infrastructure/in-memory-approval-verification-port';
import { InMemoryCampaignRepository } from '../infrastructure/in-memory-campaign-repository';
import { InMemoryMessageExecutionRepository } from '../infrastructure/in-memory-message-execution-repository';
import { InMemoryOutreachProviderRegistry } from '../infrastructure/in-memory-provider-registry';
import { InMemoryRecipientAllowlistRepository } from '../infrastructure/in-memory-recipient-allowlist-repository';
import { InMemorySequenceRepository } from '../infrastructure/in-memory-sequence-repository';
import { InMemorySequenceSchedulePolicy } from '../infrastructure/in-memory-schedule-policy';
import { InMemorySuppressionRepository } from '../infrastructure/in-memory-suppression-repository';
import type { IEmailProvider } from '../ports/email-provider.interface';
import { SendSafetyGate } from '../safety/send-safety-gate';

const tenantA = asTenantId('tenant-a');

function makeLead(contactSuffix = '1'): Lead {
  return {
    id: asLeadId(`lead-${contactSuffix}`),
    tenantId: tenantA,
    workspaceId: 'workspace-1',
    accountId: asAccountId(`acc-${contactSuffix}`),
    contactId: asContactId(`contact-${contactSuffix}`),
    icpProfileId: asICPProfileId('icp-1'),
    icpProfileVersionId: asICPProfileId('icp-version-1'),
    scores: {
      icpMatch: 0.9,
      signalScore: 0.8,
      intentScore: 0.7,
      evidenceConfidence: 0.9,
      overall: 0.85,
    },
    status: 'QUALIFIED',
    evidenceReferences: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Lead;
}

function makeEvidence(id: string): ResearchEvidence {
  return new ResearchEvidence({
    evidenceId: asEvidenceId(id),
    tenantId: tenantA,
    workspaceId: '00000000-0000-4000-8000-000000000001',
    requestId: asResearchRequestId(`request-${id}`),
    runId: asResearchRunId(`run-${id}`),
    claimType: 'funding-round',
    normalizedValue: 'raised Series B',
    source: 'test',
    reliabilityTier: 'PUBLIC_RECORD',
    observedAt: new Date().toISOString(),
    freshnessExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    confidence: 0.9,
    confidenceBreakdown: { sourceReliability: 0.9, extractionConfidence: 0.9, corroboration: 0.9 },
    provenance: [],
    evidenceFingerprint: `fingerprint-${id}`,
  });
}

class FakeGraphEmailProvider implements IEmailProvider {
  readonly providerId = 'graph-email';
  readonly channel = 'email' as const;
  sendCalls: ProviderSendRequest[] = [];

  async send(_ctx: TenantContext, request: ProviderSendRequest): Promise<ProviderSendResult> {
    this.sendCalls.push(request);
    return {
      status: 'PROVIDER_ACCEPTED',
      providerMessageId: `graph-msg-${request.executionId}`,
      costUsd: 0.05,
    };
  }

  async checkHealth(): Promise<{ healthy: boolean }> {
    return { healthy: true };
  }
}

class TestRecipientSource implements IOutboundRecipientSource {
  async resolveProtectedEmailRecipient(input: {
    tenantId: string;
    workspaceId: string;
    leadId: string;
    contactId: string;
  }) {
    return {
      contactId: input.contactId,
      recipientFingerprint: 'h1.1.fingerprint123',
      recipientCiphertext: 'e1.1.ciphertext456',
    };
  }
}

class TestRecipientRecovery implements IOutboundRecipientRecovery {
  async recoverEmailForSend(): Promise<string> {
    return 'test@example.com';
  }
}

class TestHistoricalRecipientFingerprint implements IHistoricalRecipientFingerprint {
  async fingerprintEmailForVersion(): Promise<string> {
    return 'h1.1.fingerprint123';
  }
}

function buildServices() {
  const ctx: TenantContext = { tenantId: tenantA, workspaceId: 'workspace-1', correlationId: asCorrelationId('corr-1') };
  const campaignRepo = new InMemoryCampaignRepository();
  const sequenceRepo = new InMemorySequenceRepository();
  const executionRepo = new InMemoryMessageExecutionRepository();
  const registry = new InMemoryOutreachProviderRegistry();
  const schedulePolicy = new InMemorySequenceSchedulePolicy();
  let seed = 0;

  const planningService = new OutreachPlanningService({
    generateSequenceId: () => asSequenceId(`seq-${++seed}`),
    recipientSource: new TestRecipientSource(),
  });
  const personalizationService = new OutreachPersonalizationService({
    reasoningEngine: {
      async reason() {
        return {
          rationale: 'stub',
          conclusion: JSON.stringify({
            subject: 'Hello',
            body: '<p>Stub body</p>',
            cta: 'Reply',
            tone: 'professional',
            claims: [],
          }),
          confidence: 0.9,
          evidence: [],
        };
      },
    },
    outputValidator: {
      async validate() {
        return { valid: true, safeOutput: '<p>Stub body</p>', piiCheck: 'PASSED' };
      },
    },
    generateMessageId: () => asOutreachMessageId(`msg-${++seed}`),
    generateExecutionId: () => `exec-${++seed}`,
    generateIdempotencyKey: (hint) => asIdempotencyKey(`idmp-${hint}-${++seed}`),
  });

  const allowlistRepo = new InMemoryRecipientAllowlistRepository();
  const suppressionRepo = new InMemorySuppressionRepository();
  const approvalPort = new InMemoryApprovalVerificationPort();
  const auditLog = new InMemoryAuditLog();
  const idempotencyStore = new InMemoryIdempotencyStore();
  const rateLimiter = new InMemoryRateLimiter();

  const safetyGate = new SendSafetyGate({
    allowlistRepository: allowlistRepo,
    suppressionRepository: suppressionRepo,
    approvalVerificationPort: approvalPort,
    rateLimiter,
    idempotencyStore,
    auditLog,
  });

  const executionService = new OutreachExecutionService({
    campaignRepository: campaignRepo,
    sequenceRepository: sequenceRepo,
    executionRepository: executionRepo,
    providerRegistry: registry,
    schedulePolicy,
    personalizationService,
    safetyGate,
    recipientRecovery: new TestRecipientRecovery(),
    historicalRecipientFingerprint: new TestHistoricalRecipientFingerprint(),
    idempotencyStore,
    generateExecutionId: () => `exec-${++seed}`,
    generateEventId: () => `evt-${++seed}` as any,
    channelCostEstimate: () => 0.05,
  });

  return {
    ctx,
    campaignRepo,
    sequenceRepo,
    executionRepo,
    registry,
    executionService,
    planningService,
    allowlistRepo,
    approvalPort,
  };
}

describe('Outreach provider resolution', () => {
  it('resolves GraphEmailProvider for tenant+email when mapping is configured and invokes it exactly once', async () => {
    const deps = buildServices();
    const { ctx } = deps;
    const provider = new FakeGraphEmailProvider();
    deps.registry.register(provider);
    deps.registry.setTenantProvider(tenantA as string, 'email', provider.providerId);

    const lead = makeLead();
    const evidence = [makeEvidence('ev-1')];
    const plan = await deps.planningService.plan(ctx, { campaignId: asCampaignId('camp-1'), lead, evidence });
    const { OutreachCampaign, OutreachSequence } = require('@projectx/domain');

    const campaign = OutreachCampaign.create(
      {
        id: plan.campaignId,
        tenantId: tenantA,
        workspaceId: 'workspace-1',
        leadId: lead.contactId as string,
        contactId: lead.contactId as string,
        recipientFingerprint: plan.recipient.recipientFingerprint,
        recipientProtectionState: plan.recipient.recipientProtectionState,
        channel: plan.channel,
        steps: plan.steps,
        missionId: 'm-1',
      },
      ctx.correlationId,
      'evt-1' as any,
    );
    campaign.submitForApproval(ctx.correlationId, 'evt-2' as any);
    campaign.approve('approver-1' as any, 'approved', ctx.correlationId, 'evt-3' as any);
    campaign.start(ctx.correlationId, 'evt-4' as any);
    await deps.campaignRepo.save(ctx, campaign);

    const sequence = OutreachSequence.create(
      {
        id: plan.sequenceId,
        tenantId: tenantA,
        workspaceId: 'workspace-1',
        campaignId: campaign.id,
        leadId: lead.contactId as string,
        contactId: lead.contactId as string,
        recipientFingerprint: plan.recipient.recipientFingerprint,
        recipientCiphertext: plan.recipient.recipientCiphertext,
        recipientProtectionState: plan.recipient.recipientProtectionState,
        steps: plan.steps,
      },
      ctx.correlationId,
      'evt-5' as any,
    );
    sequence.submitForApproval(ctx.correlationId, 'evt-seq-pending' as any);
    sequence.approve('approver-1' as any, 'approved', ctx.correlationId, 'evt-seq-approved' as any);
    sequence.start(ctx.correlationId, 'evt-seq-start' as any);
    await deps.sequenceRepo.save(ctx, sequence);

    const draft = await deps.executionService.prepareDraft(ctx, sequence.id as string, plan, lead, evidence);
    expect(draft.status).toBe('AWAITING_APPROVAL');
    if (draft.status !== 'AWAITING_APPROVAL') return;

    await deps.allowlistRepo.add(ctx, {
      channel: 'email',
      address: 'test@example.com',
      approvedBy: 'test-harness',
    });
    deps.approvalPort.seed({
      approvalId: 'approval-1',
      tenantId: tenantA as string,
      campaignId: campaign.id as string,
      sequenceId: sequence.id as string,
      executionId: draft.executionId as string,
      recipientFingerprint: plan.recipient.recipientFingerprint,
      actionType: 'OUTREACH_EMAIL_SEND',
      outcome: 'APPROVED',
    });

    const send = await deps.executionService.executeApprovedSend(ctx, draft.executionId, 'approval-1' as any);
    expect(send.status).toBe('COMPLETED');
    expect(provider.sendCalls).toHaveLength(1);
    expect(provider.sendCalls[0].channel).toBe('email');

    const execution = await deps.executionRepo.load(ctx, draft.executionId);
    expect(execution?.status).toBe('DELIVERY_PENDING');
  });

  it('fails closed when no tenant provider mapping is configured', async () => {
    const deps = buildServices();
    const { ctx } = deps;
    const provider = new FakeGraphEmailProvider();
    deps.registry.register(provider);
    // Intentionally omit setTenantProvider to simulate missing tenant config.

    const lead = makeLead();
    const evidence = [makeEvidence('ev-1')];
    const plan = await deps.planningService.plan(ctx, { campaignId: asCampaignId('camp-1'), lead, evidence });
    const { OutreachCampaign, OutreachSequence } = require('@projectx/domain');

    const campaign = OutreachCampaign.create(
      {
        id: plan.campaignId,
        tenantId: tenantA,
        workspaceId: 'workspace-1',
        leadId: lead.contactId as string,
        contactId: lead.contactId as string,
        recipientFingerprint: plan.recipient.recipientFingerprint,
        recipientProtectionState: plan.recipient.recipientProtectionState,
        channel: plan.channel,
        steps: plan.steps,
        missionId: 'm-1',
      },
      ctx.correlationId,
      'evt-1' as any,
    );
    campaign.submitForApproval(ctx.correlationId, 'evt-2' as any);
    campaign.approve('approver-1' as any, 'approved', ctx.correlationId, 'evt-3' as any);
    campaign.start(ctx.correlationId, 'evt-4' as any);
    await deps.campaignRepo.save(ctx, campaign);

    const sequence = OutreachSequence.create(
      {
        id: plan.sequenceId,
        tenantId: tenantA,
        workspaceId: 'workspace-1',
        campaignId: campaign.id,
        leadId: lead.contactId as string,
        contactId: lead.contactId as string,
        recipientFingerprint: plan.recipient.recipientFingerprint,
        recipientCiphertext: plan.recipient.recipientCiphertext,
        recipientProtectionState: plan.recipient.recipientProtectionState,
        steps: plan.steps,
      },
      ctx.correlationId,
      'evt-5' as any,
    );
    sequence.submitForApproval(ctx.correlationId, 'evt-seq-pending' as any);
    sequence.approve('approver-1' as any, 'approved', ctx.correlationId, 'evt-seq-approved' as any);
    sequence.start(ctx.correlationId, 'evt-seq-start' as any);
    await deps.sequenceRepo.save(ctx, sequence);

    const draft = await deps.executionService.prepareDraft(ctx, sequence.id as string, plan, lead, evidence);
    expect(draft.status).toBe('AWAITING_APPROVAL');
    if (draft.status !== 'AWAITING_APPROVAL') return;

    await deps.allowlistRepo.add(ctx, {
      channel: 'email',
      address: 'test@example.com',
      approvedBy: 'test-harness',
    });
    deps.approvalPort.seed({
      approvalId: 'approval-1',
      tenantId: tenantA as string,
      campaignId: campaign.id as string,
      sequenceId: sequence.id as string,
      executionId: draft.executionId as string,
      recipientFingerprint: plan.recipient.recipientFingerprint,
      actionType: 'OUTREACH_EMAIL_SEND',
      outcome: 'APPROVED',
    });

    const send = await deps.executionService.executeApprovedSend(ctx, draft.executionId, 'approval-1' as any);
    expect(send.status).toBe('FAILED');
    expect(send.reason).toContain('No provider available');
    expect(provider.sendCalls).toHaveLength(0);

    const execution = await deps.executionRepo.load(ctx, draft.executionId);
    expect(execution?.status).toBe('FAILED_PRE_SUBMISSION');
  });
});
