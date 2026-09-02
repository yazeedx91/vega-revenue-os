import type { Pool } from 'pg';
import { OutreachSequence } from '@projectx/domain';
import type { TenantContext } from '@projectx/domain';
import { FakePgPool } from '@projectx/infrastructure';
import type { IWorkflowClient, WorkflowExecutionRef, WorkflowStartResult } from '@projectx/infrastructure';
import { asCampaignId, asCorrelationId, asEventId, asOutreachExecutionId, asSequenceId, asTenantId, WorkflowIdFactory } from '@projectx/shared';
import type { OutreachPlan, Lead, ResearchEvidence } from '@projectx/domain';
import { PostgresSequenceRepository } from '../infrastructure/postgres-sequence-repository';
import { OutreachSequenceLifecycleService } from '../application/outreach-sequence-lifecycle.service';

describe('PostgresSequenceRepository', () => {
  const tenantId = asTenantId('tenant-1');
  const ctx = { tenantId, correlationId: asCorrelationId('corr-1') };

  function makeSequence() {
    return OutreachSequence.create(
      {
        id: asSequenceId('seq-1'),
        tenantId,
        campaignId: asCampaignId('camp-1'),
        leadId: 'lead-1' as any,
        recipient: { contactId: 'c1' as any, channel: 'email', address: 'a@b.com' },
        steps: [{ stepNumber: 1, channel: 'email', delayMs: 0, requiresApproval: true, objective: 'first-touch' }],
      },
      asCorrelationId('corr-1'),
      asEventId('evt-1'),
    );
  }

  function makeRepo() {
    return new PostgresSequenceRepository({ pool: new FakePgPool() as unknown as Pool });
  }

  it('preserves nextDueAt/responseDeadlineAt as real Date instances across save/reload', async () => {
    const repo = makeRepo();
    const sequence = makeSequence();
    sequence.submitForApproval(asCorrelationId('c2'), asEventId('e2'));
    sequence.approve('approver-1' as any, 'ok', asCorrelationId('c3'), asEventId('e3'));
    sequence.start(asCorrelationId('c4'), asEventId('e4'));
    const deadline = new Date(Date.now() + 60_000);
    sequence.waitForResponse(deadline, asCorrelationId('c5'), asEventId('e5'));

    await repo.save(ctx, sequence);
    const reloaded = await repo.load(ctx, sequence.id);

    expect(reloaded).not.toBeNull();
    expect(reloaded!.status).toBe('WAITING');
    expect(reloaded!.responseDeadlineAt).toBeInstanceOf(Date);
    expect(reloaded!.responseDeadlineAt!.getTime()).toBe(deadline.getTime());
  });

  it('findByCampaign returns the correct version (not hardcoded) for concurrency safety', async () => {
    const repo = makeRepo();
    const sequence = makeSequence();
    await repo.save(ctx, sequence);

    const loaded = await repo.load(ctx, sequence.id);
    loaded!.submitForApproval(asCorrelationId('c2'), asEventId('e2'));
    await repo.save(ctx, loaded!);

    const [viaFindByCampaign] = await repo.findByCampaign(ctx, sequence.campaignId);
    expect(viaFindByCampaign.status).toBe('PENDING_APPROVAL');
    // Must be able to continue mutating without a stale-version conflict.
    viaFindByCampaign.approve('approver-1' as any, 'ok', asCorrelationId('c3'), asEventId('e3'));
    await expect(repo.save(ctx, viaFindByCampaign)).resolves.not.toThrow();
  });

  class FakeWorkflowClient implements IWorkflowClient {
    async start<TInput>(
      ctx: TenantContext,
      workflowType: string,
      input: TInput,
      options?: { workflowId: string; taskQueue: string; timeoutSeconds: number },
    ): Promise<WorkflowStartResult> {
      return {
        workflowId: options?.workflowId ?? 'wf-1',
        status: 'STARTED',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
      };
    }
    async signal<TSignal>(ctx: TenantContext, ref: WorkflowExecutionRef, signalName: string, payload: TSignal): Promise<void> {}
    async query<TResult>(ctx: TenantContext, ref: WorkflowExecutionRef, queryName: string): Promise<TResult> {
      return undefined as TResult;
    }
    async cancel(ctx: TenantContext, ref: WorkflowExecutionRef): Promise<void> {}
  }

  it('persists workflowId/workflowStartedAt through create-start-save-reload', async () => {
    const repo = makeRepo();
    const sequence = makeSequence();

    const service = new OutreachSequenceLifecycleService({
      sequenceRepository: repo,
      workflowClient: new FakeWorkflowClient(),
      generateExecutionId: () => asOutreachExecutionId('exec-1'),
      generateEventId: () => asEventId('evt-link'),
    });

    const result = await service.startWorkflow(ctx, sequence, {
      plan: {} as OutreachPlan,
      lead: {} as Lead,
      evidence: [] as ResearchEvidence[],
    });

    const expectedWorkflowId = WorkflowIdFactory.forOutreachSequence(tenantId as string, sequence.id as string);
    expect(result.workflowId).toBe(expectedWorkflowId);

    const reloaded = await repo.load(ctx, sequence.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.workflowId).toBe(expectedWorkflowId);
    expect(reloaded!.workflowStartedAt).toBeInstanceOf(Date);
  });
});
