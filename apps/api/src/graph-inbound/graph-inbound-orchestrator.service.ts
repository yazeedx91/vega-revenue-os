import { Injectable } from '@nestjs/common';
import type { TenantContext } from '@projectx/domain';
import type { IAuditLog } from '@projectx/infrastructure';
import {
  ConversationHandlingService,
  persistReplyBasedOptOut,
} from '@projectx/conversation';
import type {
  GraphChangeNotification,
  GraphInboundIngressService,
  IMessageExecutionRepository,
  ISuppressionRepository,
  ITemporalSignalDispatcher,
} from '@projectx/outreach';
import { WorkflowIdFactory } from '@projectx/outreach';
import { asTenantId } from '@projectx/shared';

import type { ITelemetry } from '@projectx/infrastructure';

export interface GraphInboundOrchestratorConfig {
  readonly ingressService: GraphInboundIngressService;
  readonly conversationService: ConversationHandlingService;
  readonly suppressionRepository: ISuppressionRepository;
  readonly messageExecutionRepository: IMessageExecutionRepository;
  readonly signalDispatcher: ITemporalSignalDispatcher;
  readonly auditLog: IAuditLog;
  readonly telemetry?: ITelemetry;
  /**
   * No caller (webhook) supplies an autonomy level the way the Temporal
   * `interpretReply` activity's workflow caller does — defaults to 2
   * (matching `InMemoryNextBestActionPolicy`'s autonomous-action threshold).
   */
  readonly defaultAutonomyLevel?: number;
}

export type GraphInboundNotificationOutcome =
  | { readonly status: 'PROCESSED'; readonly conversationId: string; readonly actionType?: string; readonly requiresApproval: boolean; readonly leadStatusChanged: boolean; readonly signalOutcome?: string }
  | { readonly status: 'OPTED_OUT'; readonly conversationId: string }
  | { readonly status: 'DUPLICATE' }
  | { readonly status: 'REJECTED'; readonly reasonCode: string; readonly reason: string }
  | { readonly status: 'NOT_CORRELATED'; readonly reason: string }
  | { readonly status: 'AMBIGUOUS'; readonly reason: string };

/**
 * The one place that ties together `packages/outreach`'s Graph inbound
 * ingress pipeline (validate/dedup/normalize/correlate) with
 * `packages/conversation`'s `ConversationHandlingService`
 * (reply/intent/NBA/lead-outcome) and the Milestone 6 Temporal
 * signal-dispatch boundary. Lives in `apps/api` specifically to avoid an
 * `outreach` <-> `conversation` circular package dependency — see the
 * Milestone 6 completion report.
 */
@Injectable()
export class GraphInboundOrchestratorService {
  private readonly defaultAutonomyLevel: number;

  constructor(private readonly config: GraphInboundOrchestratorConfig) {
    this.defaultAutonomyLevel = config.defaultAutonomyLevel ?? 2;
  }

  async processNotification(notification: GraphChangeNotification): Promise<GraphInboundNotificationOutcome> {
    const ingressOutcome = await this.config.ingressService.ingest(notification);

    await this.config.auditLog.record(this.systemAuditCtx(), {
      action: 'graph_inbound_ingress',
      resourceType: 'graph_notification',
      resourceId: notification.resourceData?.id ?? notification.resource,
      result: ingressOutcome.status === 'PROCESSED' ? 'success' : ingressOutcome.status === 'DUPLICATE' ? 'success' : 'denied',
      reason: ingressOutcome.status !== 'PROCESSED' && ingressOutcome.status !== 'DUPLICATE' ? ingressOutcome.reason : undefined,
      metadata: { status: ingressOutcome.status },
    });

    if (ingressOutcome.status === 'DUPLICATE') {
      return { status: 'DUPLICATE' };
    }
    if (ingressOutcome.status === 'REJECTED') {
      return { status: 'REJECTED', reasonCode: ingressOutcome.reasonCode, reason: ingressOutcome.reason };
    }
    if (ingressOutcome.status === 'NOT_CORRELATED') {
      return { status: 'NOT_CORRELATED', reason: ingressOutcome.reason };
    }
    if (ingressOutcome.status === 'AMBIGUOUS') {
      return { status: 'AMBIGUOUS', reason: ingressOutcome.reason };
    }

    const event = ingressOutcome.event;
    const ctx = { tenantId: asTenantId(event.tenantId), workspaceId: event.workspaceId, correlationId: `graph-reply-${event.providerMessageId}` };

    const handleResult = await this.config.conversationService.handleReply(ctx, event);

    if (handleResult.isOptOut) {
      await persistReplyBasedOptOut(ctx, event, {
        suppressionRepository: this.config.suppressionRepository,
        messageExecutionRepository: this.config.messageExecutionRepository,
      });
      await this.config.auditLog.record(ctx, {
        action: 'graph_inbound_opt_out',
        resourceType: 'conversation',
        resourceId: handleResult.conversationId,
        result: 'success',
      });
      return { status: 'OPTED_OUT', conversationId: handleResult.conversationId };
    }

    const conversation = await this.config.conversationService.load(ctx, handleResult.conversationId);
    if (!conversation) {
      return { status: 'REJECTED', reasonCode: 'CONVERSATION_NOT_FOUND', reason: 'Conversation not found immediately after ingestion' };
    }

    const classifyResult = await this.config.conversationService.classifyAndAct(ctx, conversation, this.defaultAutonomyLevel);

    let signalOutcome: string | undefined;
    if (event.sequenceId) {
      const workflowId = WorkflowIdFactory.forOutreachSequence(event.tenantId, event.sequenceId);
      const dispatchResult = await this.config.signalDispatcher.dispatch({
        workflowId,
        signalName: 'replyReceived',
        payload: {
          providerMessageId: event.providerMessageId,
          content: event.content,
          channel: event.channel,
          responseType: 'REPLIED',
          autonomyLevel: this.defaultAutonomyLevel,
        },
        tenantId: event.tenantId,
        correlationId: ctx.correlationId,
      });
      signalOutcome = dispatchResult.outcome;

      await this.config.auditLog.record(ctx, {
        action: 'graph_inbound_signal_dispatch',
        resourceType: 'workflow',
        resourceId: workflowId,
        result: dispatchResult.outcome === 'DISPATCHED' ? 'success' : 'failure',
        reason: dispatchResult.reason,
      });
    }

    return {
      status: 'PROCESSED',
      conversationId: classifyResult.conversationId,
      actionType: classifyResult.actionType,
      requiresApproval: classifyResult.requiresApproval,
      leadStatusChanged: classifyResult.leadStatusChanged,
      signalOutcome,
    };
  }

  private systemAuditCtx(): TenantContext {
    // Ingress-stage audit entries (before tenant resolution can fail) use a
    // synthetic system tenant context; entries after tenant resolution use
    // the real resolved `ctx` (see call sites above).
    return { tenantId: asTenantId('system'), correlationId: 'graph-inbound-ingress' };
  }
}
