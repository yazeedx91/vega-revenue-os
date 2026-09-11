import type { Lead, OutreachPlan, ResearchEvidence, TenantContext } from '@projectx/domain';
import type { ConversationHandlingService } from '@projectx/conversation';
import type { ReplyIngressEvent } from '@projectx/conversation';
import { persistReplyBasedOptOut as persistReplyBasedOptOutShared } from '@projectx/conversation';
import type { IMessageExecutionRepository, ISequenceRepository, ISuppressionRepository, OutreachExecutionService, OutreachRepositoryContext } from '@projectx/outreach';
import type { ApprovalId, CorrelationId, EventId, OutreachExecutionId, SequenceId, TenantId } from '@projectx/shared';

export interface OutreachActivitiesContext {
  tenantId: string;
  workspaceId: string;
  correlationId: string;
}

let executionService: OutreachExecutionService | null = null;
let conversationService: ConversationHandlingService | null = null;
let suppressionRepository: ISuppressionRepository | null = null;
let messageExecutionRepository: IMessageExecutionRepository | null = null;
let sequenceRepository: ISequenceRepository | null = null;

export function setOutreachExecutionService(service: OutreachExecutionService): void {
  executionService = service;
}

export function setConversationHandlingService(service: ConversationHandlingService): void {
  conversationService = service;
}

/**
 * Wires the durable suppression store so reply-based opt-outs detected by
 * the conversation package become a persistent record that blocks every
 * future outbound send path — not just the conversation flow that detected
 * it. Optional: if not set, opt-out detection still works but is not
 * persisted as a cross-path suppression (logged at call time instead).
 */
export function setSuppressionRepository(repository: ISuppressionRepository): void {
  suppressionRepository = repository;
}

export function setMessageExecutionRepository(repository: IMessageExecutionRepository): void {
  messageExecutionRepository = repository;
}

export function setSequenceRepository(repository: ISequenceRepository): void {
  sequenceRepository = repository;
}

function getService(): OutreachExecutionService {
  if (!executionService) {
    throw new Error('Outreach execution service not initialized');
  }
  return executionService;
}

function getConversationService(): ConversationHandlingService {
  if (!conversationService) {
    throw new Error('Conversation handling service not initialized');
  }
  return conversationService;
}

function toTenantContext(ctx: OutreachActivitiesContext): OutreachRepositoryContext {
  return {
    tenantId: ctx.tenantId as TenantId,
    workspaceId: ctx.workspaceId,
    correlationId: ctx.correlationId as CorrelationId,
  };
}

export interface SequenceSnapshot {
  sequenceId: string;
  status: string;
  currentStepIndex: number;
  nextDueAt?: Date;
  responseDeadlineAt?: Date;
}

function getSequenceRepository(): ISequenceRepository {
  if (!sequenceRepository) {
    throw new Error('Sequence repository not initialized');
  }
  return sequenceRepository;
}

function getMessageExecutionRepository(): IMessageExecutionRepository {
  if (!messageExecutionRepository) {
    throw new Error('Message execution repository not initialized');
  }
  return messageExecutionRepository;
}

export async function getSequence(ctx: OutreachActivitiesContext, sequenceId: string): Promise<SequenceSnapshot> {
  const tenantCtx = toTenantContext(ctx);
  const sequence = await getSequenceRepository().load(tenantCtx, sequenceId as SequenceId);
  if (!sequence) {
    throw new Error(`Sequence ${sequenceId} not found`);
  }
  return {
    sequenceId: sequence.id as string,
    status: sequence.status,
    currentStepIndex: sequence.currentStepIndex,
    nextDueAt: sequence.nextDueAt,
    responseDeadlineAt: sequence.responseDeadlineAt,
  };
}

export interface PrepareDraftResult {
  status: 'AWAITING_APPROVAL' | 'FAILED';
  executionId?: string;
  actionType?: string;
  reason?: string;
}

export async function prepareDraft(
  ctx: OutreachActivitiesContext,
  sequenceId: string,
  plan: OutreachPlan,
  lead: Lead,
  evidence: ResearchEvidence[],
): Promise<PrepareDraftResult> {
  const result = await getService().prepareDraft(toTenantContext(ctx), sequenceId, plan, lead, evidence);
  if (result.status === 'AWAITING_APPROVAL') {
    return {
      status: 'AWAITING_APPROVAL',
      executionId: result.executionId as string,
      actionType: result.actionType,
    };
  }
  return { status: 'FAILED', reason: (result as { reason: string }).reason ?? 'Unknown' };
}

export interface ExecuteSendResult {
  status: 'COMPLETED' | 'RETRYABLE' | 'FAILED';
  nextDueAt?: Date;
  nextDueDelayMs?: number;
  retryAfterMs?: number;
  reason?: string;
}

export async function executeSend(
  ctx: OutreachActivitiesContext,
  executionId: string,
  approvalId: string,
): Promise<ExecuteSendResult> {
  const tenantCtx = toTenantContext(ctx);

  // Re-verify the execution actually belongs to this activity's tenant by
  // loading the stored aggregate. The service will also re-check, but this
  // ensures the tenant identity used here comes from the DB, not the input.
  if (messageExecutionRepository) {
    const execution = await messageExecutionRepository.load(tenantCtx, executionId as OutreachExecutionId);
    if (!execution) {
      return { status: 'FAILED', reason: `Execution ${executionId} not found for tenant ${ctx.tenantId}` };
    }
    if (execution.tenantId !== tenantCtx.tenantId) {
      return { status: 'FAILED', reason: 'Execution tenant mismatch' };
    }
  }

  const result = await getService().executeApprovedSend(
    tenantCtx,
    executionId as OutreachExecutionId,
    approvalId as ApprovalId,
  );
  if (result.status === 'COMPLETED') {
    const now = Date.now();
    const nextDueDelayMs = result.nextDueAt ? Math.max(0, result.nextDueAt.getTime() - now) : 0;
    return { status: 'COMPLETED', nextDueAt: result.nextDueAt, nextDueDelayMs };
  }
  if (result.status === 'RETRYABLE') {
    return { status: 'RETRYABLE', retryAfterMs: result.retryAfterMs ?? 60000 };
  }
  return { status: 'FAILED', reason: result.reason };
}

export interface ExpireApprovalWaitResult {
  status: 'EXPIRED' | 'SKIPPED';
  reason?: string;
}

/**
 * Persists the terminal state for an execution whose explicitly bounded
 * approval wait elapsed (Phase 14.8). Transitions PENDING_APPROVAL -> FAILED
 * so the database never claims an approval is still awaitable after the
 * workflow completes with TIMEOUT. Idempotent: any other status (including
 * already-terminal ones) is left untouched and reported as SKIPPED. Never
 * touches the provider, safety gate, or approval records.
 */
export async function expireApprovalWait(
  ctx: OutreachActivitiesContext,
  executionId: string,
  reason: string,
): Promise<ExpireApprovalWaitResult> {
  const repository = getMessageExecutionRepository();
  const tenantCtx = toTenantContext(ctx);
  const execution = await repository.load(tenantCtx, executionId as OutreachExecutionId);
  if (!execution) {
    return { status: 'SKIPPED', reason: `Execution ${executionId} not found` };
  }
  if (execution.status !== 'PENDING_APPROVAL') {
    return { status: 'SKIPPED', reason: `Execution status is ${execution.status}, not PENDING_APPROVAL` };
  }
  const eventId = `evt-approval-expired-${executionId}` as EventId;
  const result = execution.markFailed('NON_RETRYABLE', reason, undefined, ctx.correlationId as CorrelationId, eventId);
  if (!result.success) {
    return { status: 'SKIPPED', reason: result.error.message };
  }
  await repository.save(tenantCtx, execution);
  return { status: 'EXPIRED' };
}

export interface RecordResponseResult {
  status: 'COMPLETED' | 'FAILED';
  reason?: string;
}

export async function recordResponse(
  ctx: OutreachActivitiesContext,
  executionId: string,
  responseType: 'REPLIED' | 'OPENED',
): Promise<RecordResponseResult> {
  try {
    await getService().recordResponse(
      toTenantContext(ctx),
      executionId as OutreachExecutionId,
      responseType,
    );
    return { status: 'COMPLETED' };
  } catch (error) {
    return { status: 'FAILED', reason: error instanceof Error ? error.message : String(error) };
  }
}

export interface InterpretReplyResult {
  status: 'COMPLETED' | 'FAILED';
  conversationId?: string;
  actionType?: string;
  requiresApproval?: boolean;
  reason?: string;
}

export async function interpretReply(
  ctx: OutreachActivitiesContext,
  event: ReplyIngressEvent,
  autonomyLevel: number,
): Promise<InterpretReplyResult> {
  const service = getConversationService();
  const tenantCtx = toTenantContext(ctx);
  const handleResult = await service.handleReply(tenantCtx, event);
  if (handleResult.isOptOut) {
    await persistReplyBasedOptOut(tenantCtx, event);
    return {
      status: 'COMPLETED',
      conversationId: handleResult.conversationId,
      actionType: 'CLOSE',
      requiresApproval: false,
      reason: 'Prospect opted out',
    };
  }

  const conversation = await service.load(tenantCtx, handleResult.conversationId);
  if (!conversation) {
    return { status: 'FAILED', reason: 'Conversation not found after ingestion' };
  }

  const classifyResult = await service.classifyAndAct(tenantCtx, conversation, autonomyLevel);
  return {
    status: 'COMPLETED',
    conversationId: classifyResult.conversationId,
    actionType: classifyResult.actionType,
    requiresApproval: classifyResult.requiresApproval,
    reason: classifyResult.reason,
  };
}

/**
 * Thin delegate to the shared `persistReplyBasedOptOut` helper
 * (`@projectx/conversation`, Phase 14 Milestone 6) — see that function for
 * the resolution logic. If either dependency here is not wired, this is a
 * no-op (the opt-out is still honored within the conversation itself via
 * `conversation.optedOut`).
 */
async function persistReplyBasedOptOut(ctx: TenantContext, event: ReplyIngressEvent): Promise<void> {
  if (!suppressionRepository || !messageExecutionRepository) {
    return;
  }
  await persistReplyBasedOptOutShared(ctx, event, {
    suppressionRepository,
    messageExecutionRepository,
  });
}
