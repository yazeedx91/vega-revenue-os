import { condition, defineSignal, proxyActivities, setHandler, sleep } from '@temporalio/workflow';
import type { Lead, OutreachPlan, ResearchEvidence } from '@projectx/domain';
import type * as activities from '../activities/outreach-activities';

const { getSequence, prepareDraft, executeSend, recordResponse, interpretReply, expireApprovalWait } = proxyActivities<
  typeof activities
>({
  startToCloseTimeout: '1 minute',
  retry: { maximumAttempts: 1 },
});

export interface OutreachApprovalSignal {
  executionId: string;
  approvalId: string;
}

export interface ReplyReceivedSignal {
  providerMessageId: string;
  content: string;
  channel: string;
  responseType: 'REPLIED' | 'OPENED';
  autonomyLevel: number;
}

const approvalSignal = defineSignal<[OutreachApprovalSignal]>('outreachApprovalGranted');
const replySignal = defineSignal<[ReplyReceivedSignal]>('replyReceived');

export interface OutreachSequenceWorkflowInput {
  tenantId: string;
  correlationId: string;
  sequenceId: string;
  plan: OutreachPlan;
  lead: Lead;
  evidence: ResearchEvidence[];
  maxIterations?: number;
  replyTimeoutMs?: number;
  /**
   * Optional approval wait bound. When omitted the workflow waits durably
   * (indefinitely) for the human approval signal — the canonical
   * human-in-the-loop behavior (Phase 14.8). When explicitly supplied and
   * exceeded, the pending execution is persisted as FAILED via
   * `expireApprovalWait` before the workflow completes with TIMEOUT, so the
   * database never claims an approval is still awaitable for a dead workflow.
   */
  approvalTimeoutMs?: number;
}

export async function OutreachSequenceWorkflow(
  input: OutreachSequenceWorkflowInput,
): Promise<{ status: 'COMPLETED' | 'FAILED' | 'TIMEOUT'; reason?: string }> {
  const pendingApproval = { current: null as OutreachApprovalSignal | null };
  setHandler(approvalSignal, (payload: OutreachApprovalSignal) => {
    pendingApproval.current = payload;
  });

  const pendingReply = { current: null as ReplyReceivedSignal | null };
  setHandler(replySignal, (payload: ReplyReceivedSignal) => {
    pendingReply.current = payload;
  });

  const ctx = {
    tenantId: input.tenantId,
    correlationId: input.correlationId,
  };

  const maxIterations = input.maxIterations ?? 50;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const sequence = await getSequence(ctx, input.sequenceId);

    if (['COMPLETED', 'CANCELLED', 'FAILED'].includes(sequence.status)) {
      return { status: sequence.status as 'COMPLETED' | 'FAILED', reason: 'Sequence reached terminal state' };
    }

    const draftResult = await prepareDraft(ctx, input.sequenceId, input.plan, input.lead, input.evidence);

    if (draftResult.status === 'FAILED') {
      return { status: 'FAILED', reason: draftResult.reason ?? 'Draft preparation failed' };
    }

    if (!draftResult.executionId) {
      return { status: 'FAILED', reason: 'Draft result missing executionId' };
    }

    // Wait durably for the approval signal. Only an explicitly supplied
    // approvalTimeoutMs bounds the wait; there is deliberately no default.
    if (input.approvalTimeoutMs !== undefined) {
      const approvalReceived = await condition(() => pendingApproval.current !== null, input.approvalTimeoutMs);
      if (!approvalReceived) {
        const timeoutReason = 'Timed out waiting for approval signal';
        await expireApprovalWait(ctx, draftResult.executionId, timeoutReason);
        return { status: 'TIMEOUT', reason: timeoutReason };
      }
    } else {
      await condition(() => pendingApproval.current !== null);
    }
    const approval = pendingApproval.current;
    if (!approval) {
      return { status: 'FAILED', reason: 'Approval signal handler yielded no payload' };
    }

    const sendResult = await executeSend(ctx, approval.executionId, approval.approvalId);
    pendingApproval.current = null;

    if (sendResult.status === 'FAILED') {
      return { status: 'FAILED', reason: sendResult.reason ?? 'Send execution failed' };
    }

    if (sendResult.status === 'COMPLETED') {
      const replyTimeoutMs = input.replyTimeoutMs ?? 600_000;
      const receivedReply = await condition(() => pendingReply.current !== null, replyTimeoutMs);
      const reply = pendingReply.current;
      if (receivedReply && reply) {
        await recordResponse(ctx, approval.executionId, reply.responseType);
        await interpretReply(ctx, {
          tenantId: input.tenantId,
          leadId: input.lead.id,
          channel: reply.channel,
          providerMessageId: reply.providerMessageId,
          content: reply.content,
          receivedAt: new Date(),
          executionId: approval.executionId,
        }, reply.autonomyLevel);
        pendingReply.current = null;
      }

      const now = Date.now();
      const nextDueDelayMs = sendResult.nextDueAt ? Math.max(0, sendResult.nextDueAt.getTime() - now) : 0;

      if (nextDueDelayMs && nextDueDelayMs > 0) {
        await sleep(nextDueDelayMs);
      } else {
        // No more steps scheduled; loop once more to detect terminal state.
        await sleep(1000);
      }
    }

    if (sendResult.status === 'RETRYABLE') {
      await sleep(sendResult.retryAfterMs ?? 60_000);
      continue;
    }
  }

  return { status: 'FAILED', reason: 'Exceeded maximum workflow iterations' };
}
