import { describe, expect, it } from '@jest/globals';
import { InMemorySequenceRepository, OutreachSequenceLifecycleService } from '@projectx/outreach';
import { OutreachSequence } from '@projectx/domain';
import type { TenantContext } from '@projectx/domain';
import { asCampaignId, asCorrelationId, asEventId, asOutreachExecutionId, asSequenceId, asTenantId, WorkflowIdFactory } from '@projectx/shared';
import type { IWorkflowClient, WorkflowExecutionRef, WorkflowStartResult } from '@projectx/infrastructure';
import type { OutreachPlan, Lead, ResearchEvidence } from '@projectx/domain';
import type { OutreachSequenceWorkflowStartResult } from '@projectx/outreach';

describe('OutreachSequenceLifecycleService', () => {
  const tenantId = asTenantId('tenant-1');
  const ctx: TenantContext = { tenantId, workspaceId: 'workspace-1', correlationId: asCorrelationId('corr-1') };

  class FakeWorkflowClient implements IWorkflowClient {
    starts: Array<{
      ctx: TenantContext;
      workflowType: string;
      input: unknown;
      options?: { workflowId: string; taskQueue: string; timeoutSeconds: number };
    }> = [];
    signals: Array<{ ref: WorkflowExecutionRef; signalName: string; payload: unknown }> = [];
    readonly startedWorkflowIds = new Set<string>();

    async start<TInput>(
      ctx: TenantContext,
      workflowType: string,
      input: TInput,
      options?: { workflowId: string; taskQueue: string; timeoutSeconds: number },
    ): Promise<WorkflowStartResult> {
      const workflowId = options?.workflowId ?? 'wf-1';
      this.starts.push({ ctx, workflowType, input, options });

      if (this.startedWorkflowIds.has(workflowId)) {
        return {
          workflowId,
          status: 'ALREADY_RUNNING',
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
        };
      }

      this.startedWorkflowIds.add(workflowId);
      return {
        workflowId,
        status: 'STARTED',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
      };
    }

    async signal<TSignal>(ctx: TenantContext, ref: WorkflowExecutionRef, signalName: string, payload: TSignal): Promise<void> {
      this.signals.push({ ref, signalName, payload });
    }

    async query<TResult>(ctx: TenantContext, ref: WorkflowExecutionRef, queryName: string): Promise<TResult> {
      return undefined as TResult;
    }

    async cancel(ctx: TenantContext, ref: WorkflowExecutionRef): Promise<void> {}
  }

  function makeSequence() {
    return OutreachSequence.create(
      {
        id: asSequenceId('seq-1'),
        tenantId,
        workspaceId: 'workspace-1',
        campaignId: asCampaignId('camp-1'),
        leadId: 'lead-1' as any,
        contactId: 'contact-1',
        recipientFingerprint: 'h1.1.fingerprint123',
        recipientCiphertext: 'e1.1.ciphertext456',
        recipientProtectionState: 'PROTECTED',
        steps: [{ stepNumber: 1, channel: 'email', delayMs: 0, requiresApproval: true, objective: 'first-touch' }],
      },
      asCorrelationId('corr-create'),
      asEventId('evt-create'),
    );
  }

  function makeService(client: IWorkflowClient) {
    return new OutreachSequenceLifecycleService({
      sequenceRepository: new InMemorySequenceRepository(),
      workflowClient: client,
      generateExecutionId: () => asOutreachExecutionId('exec-1'),
      generateEventId: () => asEventId('evt-1'),
    });
  }

  it('starts a workflow with the deterministic workflowId and links the aggregate', async () => {
    const sequence = makeSequence();
    const client = new FakeWorkflowClient();
    const repo = new InMemorySequenceRepository();
    await repo.save(ctx, sequence);

    const service = new OutreachSequenceLifecycleService({
      sequenceRepository: repo,
      workflowClient: client,
      generateExecutionId: () => asOutreachExecutionId('exec-1'),
      generateEventId: () => asEventId('evt-1'),
    });

    const plan: OutreachPlan = { steps: [{ channel: 'email', objective: 'intro' }] } as any;
    const lead: Lead = { id: 'lead-1', email: 'a@b.com' } as any;
    const evidence: ResearchEvidence[] = [];

    const result = await service.startWorkflow(ctx, sequence, { plan, lead, evidence });

    const expectedWorkflowId = WorkflowIdFactory.forOutreachSequence(tenantId as string, sequence.id as string);
    expect(result.workflowId).toBe(expectedWorkflowId);
    expect(result.status).toBe('STARTED');
    expect(client.starts).toHaveLength(1);
    expect(client.starts[0].workflowType).toBe('OutreachSequenceWorkflow');
    expect(client.starts[0].options).toMatchObject({
      workflowId: expectedWorkflowId,
      taskQueue: 'outreach-execution',
      timeoutSeconds: 86400,
    });
    expect(sequence.domainEvents.some((e) => e.eventType === 'SequenceWorkflowLinked')).toBe(true);

    const reloaded = await repo.load(ctx, sequence.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.workflowId).toBe(expectedWorkflowId);
    expect(reloaded!.workflowStartedAt).toBeInstanceOf(Date);
  });

  it('returns null from loadAndStartWorkflow when sequence is missing', async () => {
    const client = new FakeWorkflowClient();
    const service = makeService(client);

    const result = await service.loadAndStartWorkflow(ctx, asSequenceId('missing'), {
      plan: {} as OutreachPlan,
      lead: {} as Lead,
      evidence: [],
    });

    expect(result).toBeNull();
    expect(client.starts).toHaveLength(0);
  });

  it('treats a duplicate start as idempotent and does not create a second workflow', async () => {
    const sequence = makeSequence();
    const client = new FakeWorkflowClient();
    const repo = new InMemorySequenceRepository();
    await repo.save(ctx, sequence);

    const service = new OutreachSequenceLifecycleService({
      sequenceRepository: repo,
      workflowClient: client,
      generateExecutionId: () => asOutreachExecutionId('exec-1'),
      generateEventId: () => asEventId('evt-1'),
    });

    const input = { plan: {} as OutreachPlan, lead: {} as Lead, evidence: [] };

    const first = await service.startWorkflow(ctx, sequence, input);
    expect(first.status).toBe('STARTED');

    const second = await service.startWorkflow(ctx, sequence, input);
    expect(second.status).toBe('ALREADY_RUNNING');
    expect(second.workflowId).toBe(first.workflowId);
    expect(client.starts.filter((s) => s.options?.workflowId === first.workflowId)).toHaveLength(2);
    expect(client.startedWorkflowIds.size).toBe(1);
  });

  it('concurrent starts of the same sequence cannot create two workflows', async () => {
    const repo = new InMemorySequenceRepository();
    const original = makeSequence();
    await repo.save(ctx, original);

    const client = new FakeWorkflowClient();
    const input = { plan: {} as OutreachPlan, lead: {} as Lead, evidence: [] };

    const results = await Promise.all([
      (async () => {
        const sequence = (await repo.load(ctx, original.id))!;
        const service = new OutreachSequenceLifecycleService({
          sequenceRepository: repo,
          workflowClient: client,
          generateExecutionId: () => asOutreachExecutionId('exec-1'),
          generateEventId: () => asEventId('evt-1'),
        });
        return service.startWorkflow(ctx, sequence, input);
      })(),
      (async () => {
        const sequence = (await repo.load(ctx, original.id))!;
        const service = new OutreachSequenceLifecycleService({
          sequenceRepository: repo,
          workflowClient: client,
          generateExecutionId: () => asOutreachExecutionId('exec-2'),
          generateEventId: () => asEventId('evt-2'),
        });
        return service.startWorkflow(ctx, sequence, input);
      })(),
    ]);

    const workflowIds = new Set(results.map((r: OutreachSequenceWorkflowStartResult) => r.workflowId));
    expect(workflowIds.size).toBe(1);
    expect(client.startedWorkflowIds.size).toBe(1);
    const startStatuses = results.map((r: OutreachSequenceWorkflowStartResult) => r.status);
    expect(startStatuses.sort()).toEqual(['ALREADY_RUNNING', 'STARTED']);
  });
});
