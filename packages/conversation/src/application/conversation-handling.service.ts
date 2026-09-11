import type { Conversation, TenantContext } from '@projectx/domain';
import { Conversation as ConversationAggregate, ReplyMessage } from '@projectx/domain';
import type { CorrelationId, EventId, LeadId, ReplyMessageId } from '@projectx/shared';
import { asConversationId, asReplyMessageId } from '@projectx/shared';
import type { ConversationRepositoryContext, IConversationRepository } from '../ports/conversation-repository.interface';
import type { IIntentClassifier } from '../ports/intent-classifier.interface';
import type { ILeadRepository } from '../ports/lead-repository.interface';
import type { INextBestActionPolicy } from '../ports/next-best-action-policy.interface';
import type { IPIIScrubber } from '../ports/pii-scrubber.interface';
import type { ReplyIngressEvent } from '../ports/reply-ingress.interface';

export interface ConversationHandlingServiceDeps {
  readonly conversationRepository: IConversationRepository;
  readonly leadRepository: ILeadRepository;
  readonly intentClassifier: IIntentClassifier;
  readonly nextBestActionPolicy: INextBestActionPolicy;
  readonly piiScrubber: IPIIScrubber;
  readonly generateConversationId: () => string;
  readonly generateReplyMessageId: () => string;
  readonly generateEventId: () => string;
}

export interface HandleReplyResult {
  readonly conversationId: string;
  readonly status: string;
  readonly isOptOut: boolean;
}

export interface ClassifyAndActResult {
  readonly conversationId: string;
  readonly status: string;
  readonly actionType?: string;
  readonly requiresApproval: boolean;
  readonly reason: string;
  readonly leadStatusChanged: boolean;
}

export class ConversationHandlingService {
  constructor(private readonly deps: ConversationHandlingServiceDeps) {}

  async load(ctx: ConversationRepositoryContext, id: string): Promise<Conversation | null> {
    return this.deps.conversationRepository.load(ctx, id as unknown as import('@projectx/shared').ConversationId);
  }

  async handleReply(ctx: ConversationRepositoryContext, event: ReplyIngressEvent): Promise<HandleReplyResult> {
    let conversation = await this.deps.conversationRepository.findByLeadAndChannel(
      ctx,
      event.leadId as string,
      event.channel,
    );

    if (!conversation) {
      conversation = ConversationAggregate.create(
        {
          id: asConversationId(this.deps.generateConversationId()),
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          leadId: event.leadId as LeadId,
          channel: event.channel,
          campaignId: event.campaignId,
          sequenceId: event.sequenceId,
          executionId: event.executionId,
        },
        ctx.correlationId as CorrelationId,
        this.deps.generateEventId() as EventId,
      );
    }

    const reply = new ReplyMessage({
      id: asReplyMessageId(this.deps.generateReplyMessageId()),
      providerMessageId: event.providerMessageId,
      channel: event.channel,
      content: this.deps.piiScrubber.scrub(event.content),
      receivedAt: event.receivedAt,
      messageIdHeader: event.messageIdHeader,
      subject: event.subject ? this.deps.piiScrubber.scrub(event.subject) : event.subject,
      // htmlBody is expected to already be XSS-sanitized by the inbound
      // ingress pipeline before this point; it is intentionally not
      // PII-scrubbed here (rich content is stored, not fed to prompts).
      htmlBody: event.htmlBody,
      inReplyTo: event.inReplyTo,
      references: event.references,
    });

    conversation.recordReply(reply, ctx.correlationId as CorrelationId, this.deps.generateEventId() as EventId);
    await this.deps.conversationRepository.save(ctx, conversation);

    return {
      conversationId: conversation.id,
      status: conversation.status,
      isOptOut: conversation.optedOut,
    };
  }

  async classifyAndAct(
    ctx: ConversationRepositoryContext,
    conversation: Conversation,
    autonomyLevel: number,
  ): Promise<ClassifyAndActResult> {
    if (conversation.optedOut || conversation.status === 'DISQUALIFIED' || conversation.status === 'CLOSED') {
      return {
        conversationId: conversation.id,
        status: conversation.status,
        requiresApproval: false,
        reason: 'Conversation already terminal',
        leadStatusChanged: false,
      };
    }

    if (!conversation.latestIntent) {
      const latestMessage = conversation.messages[conversation.messages.length - 1];
      const classification = await this.deps.intentClassifier.classify(
        ctx,
        latestMessage?.content ?? '',
        conversation.channel,
      );
      const classifyResult = conversation.classifyIntent(
        classification,
        ctx.correlationId as CorrelationId,
        this.deps.generateEventId() as EventId,
      );
      if (!classifyResult.success) {
        throw new Error(`Classify intent failed: ${classifyResult.error.message}`);
      }
    }

    const action = this.deps.nextBestActionPolicy.decide(conversation, autonomyLevel);
    const decideResult = conversation.decideAction(
      action,
      ctx.correlationId as CorrelationId,
      this.deps.generateEventId() as EventId,
    );
    if (!decideResult.success) {
      throw new Error(`Decide action failed: ${decideResult.error.message}`);
    }

    let leadStatusChanged = false;
    if (action.actionType === 'DISQUALIFY' || conversation.optedOut) {
      leadStatusChanged = await this.updateLeadStatus(ctx, conversation.leadId as string, 'NOT_QUALIFIED', action.reason);
      if (conversation.status !== 'OPTED_OUT') {
        conversation.close('DISQUALIFIED', action.reason, ctx.correlationId as CorrelationId, this.deps.generateEventId() as EventId);
      }
    } else if (action.actionType === 'SCHEDULE_MEETING_DEFERRED' || action.actionType === 'FOLLOW_UP') {
      if (conversation.latestIntent === 'POSITIVE' || conversation.latestIntent === 'MEETING_REQUEST') {
        leadStatusChanged = await this.updateLeadStatus(ctx, conversation.leadId as string, 'QUALIFIED', 'Positive conversation outcome');
      }
    }

    await this.deps.conversationRepository.save(ctx, conversation);

    return {
      conversationId: conversation.id,
      status: conversation.status,
      actionType: action.actionType,
      requiresApproval: action.requiresApproval,
      reason: action.reason,
      leadStatusChanged,
    };
  }

  private async updateLeadStatus(
    ctx: ConversationRepositoryContext,
    leadId: string,
    outcome: 'QUALIFIED' | 'NOT_QUALIFIED',
    reason: string,
  ): Promise<boolean> {
    const lead = await this.deps.leadRepository.load(ctx, leadId as LeadId);
    if (!lead) {
      return false;
    }
    const result = lead.recordConversationOutcome(
      outcome,
      reason,
      ctx.correlationId as CorrelationId,
      this.deps.generateEventId() as EventId,
    );
    if (!result.success) {
      return false;
    }
    await this.deps.leadRepository.save(ctx, lead);
    return true;
  }
}
