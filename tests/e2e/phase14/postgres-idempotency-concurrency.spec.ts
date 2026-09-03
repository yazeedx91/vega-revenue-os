import { Pool } from 'pg';
import type { RedisClientType } from 'redis';
import { randomUUID } from 'crypto';
import type { ProviderHealth, ProviderSendRequest, ProviderSendResult, TenantContext } from '@projectx/domain';
import type { IEmailProvider } from '@projectx/outreach';
import { StubEmailProvider } from '@projectx/outreach';
import { PostgresIdempotencyStore, type IIdempotencyStore } from '@projectx/infrastructure';
import { asCorrelationId, asEventId, asIdempotencyKey } from '@projectx/shared';
import { InMemoryApprovalRepository } from '@projectx/mission-orchestrator';
import type { DurableAdapters } from './helpers';
import {
  buildCampaign,
  buildEvidence,
  buildLead,
  buildPlan,
  buildSequence,
  connectPostgres,
  connectRedis,
  createDurableAdapters,
  createExecutionService,
  createTenantContext,
  requireEnv,
  runMigrations,
  seedTenantAllowlist,
} from './helpers';

const IDEMPOTENCY_SCOPE = 'outreach:send';

describe('Phase 14 P0-1 PostgreSQL multi-worker idempotency concurrency', () => {
  let pool: Pool;
  let redis: RedisClientType;
  const tenantId = `tenant-p0-1-${randomUUID()}`;

  beforeAll(async () => {
    requireEnv();
    process.env.OUTREACH_LIVE_EMAIL_ENABLED = 'false';
    if (process.env.OUTREACH_LIVE_EMAIL_ENABLED !== 'false') {
      throw new Error('P0-1 verification must run with OUTREACH_LIVE_EMAIL_ENABLED=false');
    }
    pool = await connectPostgres();
    redis = await connectRedis();
    await runMigrations();
  }, 90_000);

  const createdAdapters: DurableAdapters[] = [];
  async function track<T extends DurableAdapters>(adapters: T): Promise<T> {
    createdAdapters.push(adapters);
    return adapters;
  }

  afterEach(async () => {
    await Promise.all(createdAdapters.map((a) => a.dispose().catch(() => {})));
    createdAdapters.length = 0;
  });

  afterAll(async () => {
    await pool?.end();
    await redis?.disconnect();
  });

  function createDeferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  class CountingEmailProvider implements IEmailProvider {
    sendInvocationCount = 0;

    constructor(private readonly base: StubEmailProvider) {}

    get providerId() {
      return this.base.providerId;
    }

    get channel(): 'email' {
      return this.base.channel;
    }

    send(ctx: TenantContext, request: ProviderSendRequest): Promise<ProviderSendResult> {
      this.sendInvocationCount++;
      return this.base.send(ctx, request);
    }

    async checkHealth(ctx: TenantContext): Promise<ProviderHealth> {
      return this.base.checkHealth(ctx);
    }
  }

  async function prepareApprovedExecution(baseProvider: StubEmailProvider, approvalRepo: InMemoryApprovalRepository) {
    const adapters = await track(await createDurableAdapters());
    const ctx = createTenantContext(tenantId, { id: 'e2e-operator', role: 'admin' });
    const { service } = createExecutionService(adapters, tenantId, baseProvider, approvalRepo);

    const campaign = buildCampaign(tenantId, `campaign-${randomUUID()}`);
    const sequence = buildSequence(tenantId, campaign.id as string, `sequence-${randomUUID()}`);
    const recipientAddress = sequence.recipient.address;

    await adapters.campaignRepository.save(ctx, campaign);
    await adapters.sequenceRepository.save(ctx, sequence);
    await seedTenantAllowlist(adapters, ctx, recipientAddress);

    const lead = buildLead(tenantId);
    const evidence = [buildEvidence(tenantId)];
    const plan = buildPlan(campaign.id as string, sequence.id as string, sequence.recipient);

    const draft = await service.prepareDraft(ctx, sequence.id as any, plan, lead, evidence);
    expect(draft.status).toBe('AWAITING_APPROVAL');
    if (draft.status !== 'AWAITING_APPROVAL') {
      throw new Error(`Draft preparation failed: ${draft.status}`);
    }
    const executionId = draft.executionId;
    const approvalId = `approval-${executionId as string}`;

    // Reload the execution to get its authoritative idempotency key for the approval.
    const execution = await adapters.executionRepository.load(ctx, executionId as any);
    if (!execution) throw new Error('Execution not found after draft');
    const idempotencyKey = execution.idempotencyKey;

    const { Approval } = await import('@projectx/mission-orchestrator');
    const approval = Approval.create(
      {
        id: approvalId as any,
        tenantId: ctx.tenantId,
        missionId: 'mission-e2e',
        sequenceId: sequence.id as string,
        executionId: executionId as string,
        actionType: 'OUTREACH_EMAIL_SEND',
        riskCategory: 'HIGH',
        proposedAction: { message: 'P0-1 PostgreSQL concurrency test' },
        evidence: [],
        reasoning: 'Approved for P0-1 PostgreSQL concurrency verification',
        confidence: 0.95,
        requestedBy: 'e2e-agent',
        approverRole: 'e2e-operator',
        timeoutSeconds: 3600,
        idempotencyKey,
        correlationId: ctx.correlationId as any,
      },
      asEventId(`evt-approval-${executionId as string}`),
    );
    if (!approval.success) throw new Error(approval.error.message);
    approval.value.approve('e2e-operator' as any, 'Approved', asCorrelationId('corr-approve'), asEventId('evt-approve'));
    await approvalRepo.save(approval.value);

    return { ctx, campaign, sequence, executionId, approvalId, idempotencyKey, recipientAddress };
  }

  class LatchCountingEmailProvider implements IEmailProvider {
    sendInvocationCount = 0;

    constructor(
      private readonly base: StubEmailProvider,
      private readonly sendStarted: { resolve: () => void; promise: Promise<void> },
      private readonly sendResume: { resolve: () => void; promise: Promise<void> },
    ) {}

    get providerId() {
      return this.base.providerId;
    }

    get channel(): 'email' {
      return this.base.channel;
    }

    async send(ctx: TenantContext, request: ProviderSendRequest): Promise<ProviderSendResult> {
      this.sendInvocationCount++;
      this.sendStarted.resolve();
      await this.sendResume.promise;
      return this.base.send(ctx, request);
    }

    async checkHealth(ctx: TenantContext): Promise<ProviderHealth> {
      return this.base.checkHealth(ctx);
    }

    getSentMessages(): readonly StubSentMessage[] {
      return this.base.getSentMessages();
    }
  }

  class BarrierIdempotencyStore implements IIdempotencyStore {
    private getCount = 0;
    private reached = createDeferred();
    private released = createDeferred();
    private completed = createDeferred();
    private completedObserved = false;

    constructor(
      private readonly inner: IIdempotencyStore,
      private readonly targetKey: string,
    ) {}

    async get<TResult>(ctx: TenantContext, scope: string, key: IdempotencyKey): Promise<IdempotencyRecord<TResult> | undefined> {
      if (key === this.targetKey) {
        this.getCount++;
        // The first explicit get() is inside the loser's handleDuplicateSendIdempotency().
        if (this.getCount === 1) {
          this.reached.resolve();
        }
        if (this.getCount >= 1) {
          await this.released.promise;
        }
      }
      return this.inner.get<TResult>(ctx, scope, key);
    }

    async set<TResult>(
      ctx: TenantContext,
      scope: string,
      key: IdempotencyKey,
      result: TResult,
      options?: { ttlSeconds?: number; status?: 'PENDING' | 'COMPLETED' | 'FAILED' },
    ): Promise<void> {
      await this.inner.set(ctx, scope, key, result, options);
      if (key === this.targetKey && options?.status === 'COMPLETED' && !this.completedObserved) {
        this.completedObserved = true;
        this.completed.resolve();
      }
    }

    async claim<TResult>(
      ctx: TenantContext,
      scope: string,
      key: IdempotencyKey,
      options?: { ttlSeconds?: number },
    ): Promise<IdempotencyClaimResult<TResult>> {
      return this.inner.claim(ctx, scope, key, options);
    }

    waitForGetCount(n: number): Promise<void> {
      return this.reached.promise;
    }

    releaseGet(): void {
      this.released.resolve();
    }

    waitForCompleted(): Promise<void> {
      return this.completed.promise;
    }
  }

  async function queryIdempotencyRecord(tenantId: string, key: string) {
    const client = await pool.connect();
    try {
      await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);
      const result = await client.query(
        `SELECT status, result, created_at, expires_at FROM idempotency.keys WHERE tenant_id = $1 AND key = $2`,
        [tenantId, key],
      );
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  it('exactly one worker reaches the provider when two workers race the same approved execution', async () => {
    const baseProvider = new StubEmailProvider({ type: 'success', costUsd: 0.05 });
    const countingProvider = new CountingEmailProvider(baseProvider);
    const approvalRepo = new InMemoryApprovalRepository();

    const { ctx, executionId, approvalId, idempotencyKey } = await prepareApprovedExecution(baseProvider, approvalRepo);

    const adaptersA = await track(await createDurableAdapters());
    const adaptersB = await track(await createDurableAdapters());
    const { service: serviceA } = createExecutionService(adaptersA, tenantId, countingProvider, approvalRepo);
    const { service: serviceB } = createExecutionService(adaptersB, tenantId, countingProvider, approvalRepo);

    const [resultA, resultB] = await Promise.all([
      serviceA.executeApprovedSend(ctx, executionId as any, approvalId as any),
      serviceB.executeApprovedSend(ctx, executionId as any, approvalId as any),
    ]);

    // Required proof: exactly one raw provider invocation.
    expect(countingProvider.sendInvocationCount).toBe(1);
    expect(baseProvider.getSentMessages()).toHaveLength(1);

    // Required proof: losing worker does not perform external submission and both callers get terminal results.
    const terminalStatuses = ['COMPLETED', 'FAILED', 'RETRYABLE'];
    expect(terminalStatuses).toContain(resultA.status);
    expect(terminalStatuses).toContain(resultB.status);

    // Required proof: database idempotency state remains valid and durable.
    const idemRecord = await queryIdempotencyRecord(tenantId, idempotencyKey as string);
    expect(idemRecord).toBeDefined();
    expect(['COMPLETED', 'PENDING']).toContain(idemRecord.status);
    if (idemRecord.status === 'PENDING') {
      expect(new Date(idemRecord.expires_at).getTime()).toBeGreaterThan(Date.now() + 1_000 * 365 * 24 * 60 * 60 * 50);
    } else {
      expect(idemRecord.result?.submitted).toBe(true);
    }

    // Required proof: execution state remains valid after both workers finish.
    const freshAdapters = await track(await createDurableAdapters());
    const execution = await freshAdapters.executionRepository.load(ctx, executionId as any);
    expect(execution).toBeDefined();
    expect(['DELIVERY_PENDING', 'PROVIDER_ACCEPTED', 'DELIVERED', 'REPLIED', 'FAILED_PRE_SUBMISSION', 'DELIVERY_UNKNOWN', 'REQUIRES_RECONCILIATION', 'FAILED']).toContain(execution?.status);
    if (idemRecord.status === 'COMPLETED') {
      expect(['DELIVERY_PENDING', 'PROVIDER_ACCEPTED', 'DELIVERED', 'REPLIED']).toContain(execution?.status);
    }
  });

  it('losing duplicate worker never overwrites the winner DELIVERY_PENDING state', async () => {
    const baseProvider = new StubEmailProvider({ type: 'success', costUsd: 0.05 });
    const sendStarted = createDeferred();
    const sendResume = createDeferred();
    const latchProvider = new LatchCountingEmailProvider(baseProvider, sendStarted, sendResume);
    const approvalRepo = new InMemoryApprovalRepository();

    const { ctx, executionId, approvalId, idempotencyKey } = await prepareApprovedExecution(baseProvider, approvalRepo);

    const raceAdapters = await track(await createDurableAdapters());
    const barrierStore = new BarrierIdempotencyStore(raceAdapters.idempotencyStore, idempotencyKey as string);
    const adapters = { ...raceAdapters, idempotencyStore: barrierStore };
    const { service: serviceA } = createExecutionService(adapters, tenantId, latchProvider, approvalRepo);
    const { service: serviceB } = createExecutionService(adapters, tenantId, latchProvider, approvalRepo);

    const workerA = serviceA.executeApprovedSend(ctx, executionId as any, approvalId as any);
    const workerB = serviceB.executeApprovedSend(ctx, executionId as any, approvalId as any);

    await Promise.all([sendStarted.promise, barrierStore.waitForGetCount(1)]);
    sendResume.resolve();
    await barrierStore.waitForCompleted();
    barrierStore.releaseGet();
    const [resultA, resultB] = await Promise.all([workerA, workerB]);

    // Required proof: exactly one raw provider invocation.
    expect(latchProvider.sendInvocationCount).toBe(1);
    expect(baseProvider.getSentMessages()).toHaveLength(1);

    // Required proof: the loser did not resend and both workers get a terminal result.
    const terminalStatuses = ['COMPLETED', 'FAILED', 'RETRYABLE'];
    expect(terminalStatuses).toContain(resultA.status);
    expect(terminalStatuses).toContain(resultB.status);

    // Required proof: idempotency is COMPLETED and the execution was not left inconsistent.
    const idemRecord = await queryIdempotencyRecord(tenantId, idempotencyKey as string);
    expect(idemRecord).toBeDefined();
    expect(idemRecord.status).toBe('COMPLETED');
    expect(idemRecord.result?.submitted).toBe(true);

    const execution = await raceAdapters.executionRepository.load(ctx, executionId as any);
    expect(execution).toBeDefined();
    expect(execution?.status).not.toBe('DELIVERY_UNKNOWN');
    expect(['DELIVERY_PENDING', 'PROVIDER_ACCEPTED', 'DELIVERED', 'REPLIED']).toContain(execution?.status);
  });

  it('a stale PENDING idempotency record prevents provider invocation even when expired', async () => {
    const baseProvider = new StubEmailProvider({ type: 'success', costUsd: 0.05 });
    const countingProvider = new CountingEmailProvider(baseProvider);
    const approvalRepo = new InMemoryApprovalRepository();

    const { ctx, executionId, approvalId, idempotencyKey } = await prepareApprovedExecution(baseProvider, approvalRepo);

    // Seed a stale, already-expired PENDING idempotency record directly in the actual Postgres table.
    const client = await pool.connect();
    try {
      await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);
      await client.query(
        `INSERT INTO idempotency.keys (tenant_id, scope, key, status, result, expires_at)
         VALUES ($1, $2, $3, 'PENDING', $4, NOW() - INTERVAL '1 hour')
         ON CONFLICT (tenant_id, key, scope) DO UPDATE SET
           status = EXCLUDED.status,
           result = EXCLUDED.result,
           expires_at = EXCLUDED.expires_at`,
        [tenantId, IDEMPOTENCY_SCOPE, idempotencyKey as string, JSON.stringify({ submitted: false })],
      );
    } finally {
      client.release();
    }

    // Required proof: even an expired PENDING record cannot be reclaimed.
    const directClaim = await new PostgresIdempotencyStore({ pool }).claim(ctx, IDEMPOTENCY_SCOPE, idempotencyKey as any);
    expect(directClaim.claimed).toBe(false);

    // Required proof: a brand-new worker instance does not invoke the provider.
    const newAdapters = await track(await createDurableAdapters());
    const { service: newService } = createExecutionService(newAdapters, tenantId, countingProvider, approvalRepo);

    const result = await newService.executeApprovedSend(ctx, executionId as any, approvalId as any);

    expect(countingProvider.sendInvocationCount).toBe(0);
    expect(baseProvider.getSentMessages()).toHaveLength(0);
    expect(['FAILED', 'RETRYABLE']).toContain(result.status);

    // Required proof: database record remains PENDING and still expired (never reclaimed).
    const idemRecord = await queryIdempotencyRecord(tenantId, idempotencyKey as string);
    expect(idemRecord).toBeDefined();
    expect(idemRecord.status).toBe('PENDING');
    expect(new Date(idemRecord.expires_at).getTime()).toBeLessThan(Date.now());

    // Required proof: an expired PENDING claim without provider-submission evidence
    // does not mutate the execution into an ambiguous state and does not resend.
    const execution = await newAdapters.executionRepository.load(ctx, executionId as any);
    expect(execution?.status).toBe('PENDING_APPROVAL');
  });
});
