import type { TenantContext } from '@projectx/domain';
import { Conversation, ReplyMessage } from '@projectx/domain';
import { Lead } from '@projectx/domain';
import type { AIExecutionRequest, ExecutionContext, ExecutionPolicyContext } from '@projectx/shared';
import { asAccountId, asContactId, asConversationId, asICPProfileId, asLeadId, asReplyMessageId } from '@projectx/shared';
import { randomUUID } from 'crypto';
import { ConversationAgentExecutor } from '../services/conversation-agent-executor';
import { ConversationHandlingService } from '../application/conversation-handling.service';
import { DeterministicIntentClassifier } from '../infrastructure/deterministic-intent-classifier';
import { InMemoryConversationRepository } from '../infrastructure/in-memory-conversation-repository';
import { InMemoryLeadRepository } from '../infrastructure/in-memory-lead-repository';
import { InMemoryNextBestActionPolicy } from '../infrastructure/in-memory-next-best-action-policy';
import { NoOpPIIScrubber } from '../infrastructure/no-op-pii-scrubber';
import { StubReplyIngress } from '../infrastructure/stub-reply-ingress';

const tenantA = 'tenant-a';
const workspaceId = '00000000-0000-4000-8000-000000000001';

function ctx(correlationId = `corr-${randomUUID()}`): TenantContext & { workspaceId: string } {
  return { tenantId: tenantA as any, workspaceId, correlationId: correlationId as any };
}

function makeLead(tenantId = tenantA): Lead {
  return Lead.create({
    tenantId: tenantId as any,
    workspaceId,
    accountId: asAccountId('acc-1'),
    contactId: asContactId('contact-1'),
    icpProfileId: asICPProfileId('icp-1'),
  });
}

function buildService() {
  const conversationRepository = new InMemoryConversationRepository();
  const leadRepository = new InMemoryLeadRepository();
  const service = new ConversationHandlingService({
    conversationRepository,
    leadRepository,
    intentClassifier: new DeterministicIntentClassifier(),
    nextBestActionPolicy: new InMemoryNextBestActionPolicy(),
    piiScrubber: new NoOpPIIScrubber(),
    generateConversationId: () => randomUUID(),
    generateReplyMessageId: () => randomUUID(),
    generateEventId: () => randomUUID(),
  });
  return { service, conversationRepository, leadRepository };
}

describe('Conversation aggregate', () => {
  it('starts with PENDING status', () => {
    const conversation = Conversation.create(
      {
        id: asConversationId('conv-1'),
        tenantId: tenantA as any,
        leadId: asLeadId('lead-1'),
        channel: 'email',
      },
      'corr-1' as any,
      'evt-1' as any,
    );
    expect(conversation.status).toBe('PENDING');
    expect(conversation.messages).toHaveLength(0);
  });

  it('records a reply and transitions to CLASSIFIED', () => {
    const conversation = Conversation.create(
      {
        id: asConversationId('conv-1'),
        tenantId: tenantA as any,
        leadId: asLeadId('lead-1'),
        channel: 'email',
      },
      'corr-1' as any,
      'evt-1' as any,
    );
    const reply = new ReplyMessage({
      id: asReplyMessageId('reply-1'),
      providerMessageId: 'provider-1',
      channel: 'email',
      content: 'This looks interesting',
      receivedAt: new Date(),
    });
    const result = conversation.recordReply(reply, 'corr-2' as any, 'evt-2' as any);
    expect(result.success).toBe(true);
    expect(conversation.status).toBe('CLASSIFIED');
    expect(conversation.messages).toHaveLength(1);
  });

  it('classifies intent and decides follow-up for positive reply', () => {
    const conversation = Conversation.create(
      {
        id: asConversationId('conv-1'),
        tenantId: tenantA as any,
        leadId: asLeadId('lead-1'),
        channel: 'email',
      },
      'corr-1' as any,
      'evt-1' as any,
    );
    const reply = new ReplyMessage({
      id: asReplyMessageId('reply-1'),
      providerMessageId: 'provider-1',
      channel: 'email',
      content: 'Yes, I would like to learn more',
      receivedAt: new Date(),
    });
    conversation.recordReply(reply, 'corr-2' as any, 'evt-2' as any);
    const classifyResult = conversation.classifyIntent(
      { intent: 'POSITIVE', confidence: 0.9, reason: 'Explicit interest' },
      'corr-3' as any,
      'evt-3' as any,
    );
    expect(classifyResult.success).toBe(true);
    expect(conversation.latestIntent).toBe('POSITIVE');

    const actionResult = conversation.decideAction(
      { actionType: 'FOLLOW_UP', reason: 'Positive reply', requiresApproval: false },
      'corr-4' as any,
      'evt-4' as any,
    );
    expect(actionResult.success).toBe(true);
    expect(conversation.status).toBe('FOLLOW_UP_SCHEDULED');
    expect(conversation.nextAction).toBe('FOLLOW_UP');
  });

  it('opts out on explicit opt-out language', () => {
    const conversation = Conversation.create(
      {
        id: asConversationId('conv-1'),
        tenantId: tenantA as any,
        leadId: asLeadId('lead-1'),
        channel: 'email',
      },
      'corr-1' as any,
      'evt-1' as any,
    );
    const reply = new ReplyMessage({
      id: asReplyMessageId('reply-1'),
      providerMessageId: 'provider-1',
      channel: 'email',
      content: 'Please unsubscribe me',
      receivedAt: new Date(),
    });
    const result = conversation.recordReply(reply, 'corr-2' as any, 'evt-2' as any);
    expect(result.success).toBe(true);
    expect(conversation.status).toBe('OPTED_OUT');
    expect(conversation.optedOut).toBe(true);
  });

  it('prevents further replies after opt-out', () => {
    const conversation = Conversation.create(
      {
        id: asConversationId('conv-1'),
        tenantId: tenantA as any,
        leadId: asLeadId('lead-1'),
        channel: 'email',
      },
      'corr-1' as any,
      'evt-1' as any,
    );
    conversation.recordReply(
      new ReplyMessage({
        id: asReplyMessageId('reply-1'),
        providerMessageId: 'provider-1',
        channel: 'email',
        content: 'Unsubscribe',
        receivedAt: new Date(),
      }),
      'corr-2' as any,
      'evt-2' as any,
    );
    const second = conversation.recordReply(
      new ReplyMessage({
        id: asReplyMessageId('reply-2'),
        providerMessageId: 'provider-2',
        channel: 'email',
        content: 'Actually wait',
        receivedAt: new Date(),
      }),
      'corr-3' as any,
      'evt-3' as any,
    );
    expect(second.success).toBe(false);
  });
});

describe('ConversationHandlingService', () => {
  it('creates a conversation on first reply', async () => {
    const { service } = buildService();
    const result = await service.handleReply(ctx(), {
      tenantId: tenantA,
      leadId: asLeadId('lead-1'),
      channel: 'email',
      providerMessageId: 'p-1',
      content: 'Tell me more',
      receivedAt: new Date(),
    });
    expect(result.status).toBe('CLASSIFIED');
    expect(result.isOptOut).toBe(false);
  });

  it('classifies and schedules follow-up for a meeting request', async () => {
    const { service, leadRepository } = buildService();
    const lead = makeLead();
    const c = ctx();
    await leadRepository.save(c, lead);

    const handle = await service.handleReply(c, {
      tenantId: tenantA,
      workspaceId,
      leadId: lead.id,
      channel: 'email',
      providerMessageId: 'p-1',
      content: 'Can we book a meeting next week?',
      receivedAt: new Date(),
    });

    const conversation = (await service.load(c, handle.conversationId))!;
    const act = await service.classifyAndAct(c, conversation, 2);

    expect(act.actionType).toBe('SCHEDULE_MEETING_DEFERRED');
    expect(act.requiresApproval).toBe(true);
    expect(act.leadStatusChanged).toBe(true);

    const reloaded = await leadRepository.load(c, lead.id);
    expect(reloaded?.status).toBe('QUALIFIED');
  });

  it('disqualifies lead on negative reply', async () => {
    const { service, leadRepository } = buildService();
    const lead = makeLead();
    const c = ctx();
    await leadRepository.save(c, lead);

    const handle = await service.handleReply(c, {
      tenantId: tenantA,
      workspaceId,
      leadId: lead.id,
      channel: 'email',
      providerMessageId: 'p-1',
      content: 'No thanks, not interested',
      receivedAt: new Date(),
    });

    const conversation = (await service.load(c, handle.conversationId))!;
    const act = await service.classifyAndAct(c, conversation, 2);

    expect(act.actionType).toBe('DISQUALIFY');
    expect(act.leadStatusChanged).toBe(true);

    const reloaded = await leadRepository.load(c, lead.id);
    expect(reloaded?.status).toBe('NOT_QUALIFIED');
  });

  it('escalates low-confidence replies', async () => {
    const { service } = buildService();
    const handle = await service.handleReply(ctx(), {
      tenantId: tenantA,
      leadId: asLeadId('lead-1'),
      channel: 'email',
      providerMessageId: 'p-1',
      content: 'Hmm maybe',
      receivedAt: new Date(),
    });

    const conversation = (await service.load(ctx(), handle.conversationId))!;
    const act = await service.classifyAndAct(ctx(), conversation, 2);

    expect(act.actionType).toBe('ESCALATE');
    expect(act.requiresApproval).toBe(true);
  });

  it('enforces tenant isolation', async () => {
    const { service, conversationRepository } = buildService();
    const tenantB = 'tenant-b';
    const cA = ctx('corr-a');
    const cB = { tenantId: tenantB as any, correlationId: 'corr-b' as any };

    const handle = await service.handleReply(cA, {
      tenantId: tenantA,
      leadId: asLeadId('lead-1'),
      channel: 'email',
      providerMessageId: 'p-1',
      content: 'Yes please',
      receivedAt: new Date(),
    });

    const crossTenant = await conversationRepository.load(cB, handle.conversationId as any);
    expect(crossTenant).toBeNull();
  });

  it('reuses existing conversation for same lead and channel', async () => {
    const { service, conversationRepository } = buildService();
    const c = ctx();
    const leadId = asLeadId('lead-1');

    await service.handleReply(c, {
      tenantId: tenantA,
      leadId,
      channel: 'email',
      providerMessageId: 'p-1',
      content: 'First reply',
      receivedAt: new Date(),
    });

    await service.handleReply(c, {
      tenantId: tenantA,
      leadId,
      channel: 'email',
      providerMessageId: 'p-2',
      content: 'Second reply',
      receivedAt: new Date(),
    });

    const conversation = await conversationRepository.findByLeadAndChannel(c, leadId as string, 'email');
    expect(conversation?.messages).toHaveLength(2);
  });
});

describe('ConversationAgentExecutor', () => {
  function makeRequest(taskType: string, target: unknown): AIExecutionRequest {
    return {
      executionId: `exec-${randomUUID()}`,
      tenantId: tenantA as any,
      missionId: 'm-1',
      agentId: 'conversation-handler',
      agentVersion: '1.0.0',
      taskId: 'task-1',
      taskType,
      correlationId: 'corr-1' as any,
      context: { authorization: { workspaceId }, target: target as Record<string, unknown> } as ExecutionContext,
      capabilities: [],
      policyContext: {
        autonomyLevel: 2,
        riskCategory: 'MEDIUM',
        tenantPolicyVersion: '1',
        missionPolicyVersion: '1',
      } as ExecutionPolicyContext,
      budget: { maxTokens: 0, maxCostUsd: 0, maxDurationSeconds: 60 },
      idempotencyKey: `idmp-${randomUUID()}` as any,
    };
  }

  it('executes handle-reply task', async () => {
    const { service } = buildService();
    const executor = new ConversationAgentExecutor(service);

    const result = await executor.execute(
      makeRequest('handle-reply', {
        tenantId: tenantA,
        workspaceId,
        leadId: asLeadId('lead-1'),
        channel: 'email',
        providerMessageId: 'p-1',
        content: 'Interested!',
        receivedAt: new Date(),
      }),
    );

    expect(result.status).toBe('COMPLETED');
  });

  it('executes classify-and-act task', async () => {
    const { service, leadRepository } = buildService();
    const lead = makeLead();
    const c = ctx();
    await leadRepository.save(c, lead);

    const handle = await service.handleReply(c, {
      tenantId: tenantA,
      workspaceId,
      leadId: lead.id,
      channel: 'email',
      providerMessageId: 'p-1',
      content: 'Yes, book a meeting',
      receivedAt: new Date(),
    });

    const executor = new ConversationAgentExecutor(service);
    const result = await executor.execute(
      makeRequest('classify-and-act', { conversationId: handle.conversationId, autonomyLevel: 2 }),
    );

    expect(result.status).toBe('COMPLETED');
  });
});

describe('StubReplyIngress', () => {
  it('dequeues replies in order', async () => {
    const ingress = new StubReplyIngress();
    const event = {
      tenantId: tenantA,
      leadId: asLeadId('lead-1'),
      channel: 'email',
      providerMessageId: 'p-1',
      content: 'Hello',
      receivedAt: new Date(),
    };
    ingress.enqueue(event);
    const next = await ingress.next();
    expect(next).toEqual(event);
    expect(await ingress.next()).toBeNull();
  });
});
