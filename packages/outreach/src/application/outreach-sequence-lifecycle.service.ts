import type { OutreachPlan, OutreachSequence, ResearchEvidence, TenantContext } from '@projectx/domain';
import type { Lead } from '@projectx/domain';
import type { IWorkflowClient } from '@projectx/infrastructure';
import { WorkflowIdFactory } from '@projectx/shared';
import type { CorrelationId, EventId, OutreachExecutionId, SequenceId } from '@projectx/shared';
import type { ISequenceRepository } from '../ports/outreach-repository.interface';

export interface OutreachSequenceStartInput {
  plan: OutreachPlan;
  lead: Lead;
  evidence: ResearchEvidence[];
  maxIterations?: number;
  replyTimeoutMs?: number;
  /**
   * Optional approval wait bound forwarded verbatim to the workflow. When
   * omitted the workflow waits durably (indefinitely) for the human approval
   * signal. There is deliberately no default (Phase 14.8).
   */
  approvalTimeoutMs?: number;
}

export interface OutreachSequenceLifecycleDependencies {
  sequenceRepository: ISequenceRepository;
  workflowClient: IWorkflowClient;
  generateExecutionId: () => OutreachExecutionId;
  generateEventId: () => EventId;
  taskQueue?: string;
}

export interface OutreachSequenceWorkflowStartResult {
  status: 'STARTED' | 'ALREADY_RUNNING';
  workflowId: string;
  runId?: string;
}

/**
 * The one authoritative workflow-start boundary for an `OutreachSequence`.
 *
 * Workflow ID derivation is centralized in `WorkflowIdFactory` (ADR-126).
 * Idempotency is enforced by Temporal's `workflowIdReusePolicy: 'REJECT_DUPLICATE'`
 * (ADR-128), not by a local check. A duplicate start returns the existing
 * workflow reference; the domain aggregate records the link only for audit and
 * recovery.
 */
export class OutreachSequenceLifecycleService {
  constructor(private readonly deps: OutreachSequenceLifecycleDependencies) {}

  async startWorkflow(
    ctx: TenantContext,
    sequence: OutreachSequence,
    startInput: OutreachSequenceStartInput,
  ): Promise<OutreachSequenceWorkflowStartResult> {
    const workflowId = WorkflowIdFactory.forOutreachSequence(ctx.tenantId as string, sequence.id as string);

    const startResult = await this.deps.workflowClient.start(
      ctx,
      'OutreachSequenceWorkflow',
      {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        sequenceId: sequence.id,
        plan: startInput.plan,
        lead: startInput.lead,
        evidence: startInput.evidence,
        maxIterations: startInput.maxIterations,
        replyTimeoutMs: startInput.replyTimeoutMs,
        approvalTimeoutMs: startInput.approvalTimeoutMs,
      },
      {
        workflowId,
        taskQueue: this.deps.taskQueue ?? 'outreach-execution',
        timeoutSeconds: 86400,
      },
    );

    const linkResult = sequence.linkWorkflow(workflowId, ctx.correlationId as CorrelationId, this.deps.generateEventId());
    if (!linkResult.success) {
      // Workflow exists but sequence rejects the link (e.g. already linked to a
      // different id). This should not happen when the factory is correct, but
      // it is a serious consistency issue if it does.
      throw new Error(`Failed to link sequence to workflow: ${linkResult.error.message}`);
    }

    await this.deps.sequenceRepository.save(ctx, sequence);

    return {
      status: startResult.status,
      workflowId,
      runId: startResult.runId,
    };
  }

  async loadAndStartWorkflow(
    ctx: TenantContext,
    sequenceId: SequenceId,
    startInput: OutreachSequenceStartInput,
  ): Promise<OutreachSequenceWorkflowStartResult | null> {
    const sequence = await this.deps.sequenceRepository.load(ctx, sequenceId);
    if (!sequence) {
      return null;
    }
    return this.startWorkflow(ctx, sequence, startInput);
  }
}
