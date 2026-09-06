import type { TenantContext } from '@projectx/domain';
import { InMemoryIdempotencyStore } from '@projectx/infrastructure';
import {
  asCorrelationId,
  asIdempotencyKey,
  asTenantId,
  StrictToolSchemaValidator,
  type ToolCallRequest,
  type ToolDefinition,
  type ToolProviderOutcome,
} from '@projectx/shared';
import { ToolGateway } from '../tool-gateway';
import { InMemoryToolRegistry } from '../in-memory-tool-registry';
import { InMemoryToolInvocationRepository } from '../in-memory-tool-invocation-repository';
import type {
  IToolApprovalBinding,
  IToolPolicyEvaluator,
  IToolProviderReadiness,
  IToolProviderResolver,
  ToolPolicyDecision,
} from '../tool-gateway-ports';
import type { IToolProvider } from '../tool-provider.interface';

const tenantId = asTenantId('tenant-1');
const ctx: TenantContext = { tenantId, correlationId: 'corr-1' };

function def(over: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    toolDefinitionId: 'td-1',
    toolId: 'web_search',
    version: '1.0.0',
    tenantId: null,
    description: 'search',
    requiredCapabilities: ['research'],
    riskCategory: 'LOW',
    sideEffectClass: 'READ_ONLY',
    requiredApproval: false,
    providerId: 'http',
    enabled: true,
    timeoutSeconds: 30,
    maxRetries: 0,
    idempotencyRequired: false,
    lifecycle: 'ACTIVE',
    ...over,
  };
}

function request(over: Partial<ToolCallRequest> = {}): ToolCallRequest {
  return {
    toolCallId: 'tc-1',
    toolId: 'web_search',
    toolVersion: '1.0.0',
    tenantId,
    correlationId: asCorrelationId('corr-1'),
    idempotencyKey: asIdempotencyKey('idem-1'),
    authorization: {
      policyDecisionId: 'pd-1',
      decision: 'ALLOW',
      capabilities: ['research'],
      expiresAt: new Date(Date.now() + 60000),
    },
    riskCategory: 'LOW',
    input: { q: 'x' },
    timeoutSeconds: 30,
    ...over,
  };
}

function policy(over: Partial<ToolPolicyDecision> = {}): IToolPolicyEvaluator {
  return {
    evaluate: jest.fn().mockResolvedValue({
      decision: 'ALLOW',
      policyDecisionId: 'pd-1',
      capabilities: ['research'],
      autonomyAllowed: true,
      ...over,
    }),
  };
}

const approveAll: IToolApprovalBinding = { verify: jest.fn().mockResolvedValue({ approved: true }) };
const readyTrue: IToolProviderReadiness = { isReady: jest.fn().mockResolvedValue(true) };

function provider(outcome: ToolProviderOutcome | (() => Promise<ToolProviderOutcome>)) {
  const execute = typeof outcome === 'function' ? jest.fn(outcome) : jest.fn().mockResolvedValue(outcome);
  const p: IToolProvider = { providerId: 'http', execute };
  const resolver: IToolProviderResolver = { resolve: () => p };
  return { provider: p, resolver, execute };
}

function gateway(deps: {
  registry: InMemoryToolRegistry;
  policy: IToolPolicyEvaluator;
  resolver: IToolProviderResolver;
  readiness?: IToolProviderReadiness;
  approval?: IToolApprovalBinding;
  invocations?: InMemoryToolInvocationRepository;
  idempotency?: InMemoryIdempotencyStore;
}) {
  const invocations = deps.invocations ?? new InMemoryToolInvocationRepository();
  const idempotency = deps.idempotency ?? new InMemoryIdempotencyStore();
  const gw = new ToolGateway({
    registry: deps.registry,
    invocations,
    idempotency,
    policyEvaluator: deps.policy,
    approvalBinding: deps.approval ?? approveAll,
    providerReadiness: deps.readiness ?? readyTrue,
    providerResolver: deps.resolver,
    schemaValidator: new StrictToolSchemaValidator(),
  });
  return { gw, invocations, idempotency };
}

async function registryWith(...defs: ToolDefinition[]) {
  const r = new InMemoryToolRegistry();
  for (const d of defs) await r.register(ctx, d);
  return r;
}

const OK: ToolProviderOutcome = { submitted: true, resultKnown: true, retryable: false, output: { ok: true } };

describe('ToolGateway — governed execution', () => {
  it('executes an authorized, schema-valid call end-to-end', async () => {
    const registry = await registryWith(def());
    const { resolver, execute } = provider(OK);
    const { gw } = gateway({ registry, policy: policy(), resolver });
    const res = await gw.execute(request());
    expect(res.status).toBe('SUCCESS');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('DENY policy → POLICY_DENIED, zero provider calls', async () => {
    const registry = await registryWith(def());
    const { resolver, execute } = provider(OK);
    const { gw } = gateway({ registry, policy: policy({ decision: 'DENY' }), resolver });
    const res = await gw.execute(request());
    expect(res.status).toBe('POLICY_DENIED');
    expect(execute).not.toHaveBeenCalled();
  });

  it('missing capability → UNAUTHORIZED, zero provider calls', async () => {
    const registry = await registryWith(def({ requiredCapabilities: ['research', 'admin'] }));
    const { resolver, execute } = provider(OK);
    const { gw } = gateway({ registry, policy: policy({ capabilities: ['research'] }), resolver });
    const res = await gw.execute(request());
    expect(res.status).toBe('UNAUTHORIZED');
    expect(execute).not.toHaveBeenCalled();
  });

  it('autonomy denied → POLICY_DENIED', async () => {
    const registry = await registryWith(def());
    const { resolver, execute } = provider(OK);
    const { gw } = gateway({ registry, policy: policy({ autonomyAllowed: false }), resolver });
    const res = await gw.execute(request());
    expect(res.status).toBe('POLICY_DENIED');
    expect(execute).not.toHaveBeenCalled();
  });

  it('required approval not satisfied → POLICY_DENIED, zero provider calls', async () => {
    const registry = await registryWith(def({ requiredApproval: true }));
    const { resolver, execute } = provider(OK);
    const deny: IToolApprovalBinding = { verify: jest.fn().mockResolvedValue({ approved: false, reason: 'no binding' }) };
    const { gw } = gateway({ registry, policy: policy(), resolver, approval: deny });
    const res = await gw.execute(request());
    expect(res.status).toBe('POLICY_DENIED');
    expect(res.error?.code).toBe('APPROVAL_REQUIRED');
    expect(execute).not.toHaveBeenCalled();
  });

  it('input schema violation → VALIDATION_ERROR, zero provider calls', async () => {
    const registry = await registryWith(def({
      inputSchema: { type: 'object', required: ['q'], properties: { q: { type: 'string' } } },
    }));
    const { resolver, execute } = provider(OK);
    const { gw } = gateway({ registry, policy: policy(), resolver });
    const res = await gw.execute(request({ input: { q: 123 } }));
    expect(res.status).toBe('VALIDATION_ERROR');
    expect(execute).not.toHaveBeenCalled();
  });

  it('provider not ready → FAILED, zero provider calls, no claim created', async () => {
    const registry = await registryWith(def({ idempotencyRequired: true }));
    const { resolver, execute } = provider(OK);
    const notReady: IToolProviderReadiness = { isReady: jest.fn().mockResolvedValue(false) };
    const idempotency = new InMemoryIdempotencyStore();
    const claimSpy = jest.spyOn(idempotency, 'claim');
    const { gw } = gateway({ registry, policy: policy(), resolver, readiness: notReady, idempotency });
    const res = await gw.execute(request());
    expect(res.status).toBe('FAILED');
    expect(res.error?.code).toBe('PROVIDER_NOT_READY');
    expect(execute).not.toHaveBeenCalled();
    expect(claimSpy).not.toHaveBeenCalled();
  });

  it('version-less execution → VALIDATION_ERROR (no version-less execution)', async () => {
    const registry = await registryWith(def());
    const { resolver, execute } = provider(OK);
    const { gw } = gateway({ registry, policy: policy(), resolver });
    const res = await gw.execute(request({ toolVersion: '' }));
    expect(res.status).toBe('VALIDATION_ERROR');
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('ToolGateway — idempotency + crash safety', () => {
  it('creates logical invocation BEFORE the idempotency claim', async () => {
    const registry = await registryWith(def({ idempotencyRequired: true }));
    const { resolver } = provider(OK);
    const invocations = new InMemoryToolInvocationRepository();
    const idempotency = new InMemoryIdempotencyStore();
    const order: string[] = [];
    const origCreate = invocations.createInvocation.bind(invocations);
    jest.spyOn(invocations, 'createInvocation').mockImplementation(async (c: TenantContext, r: Parameters<typeof origCreate>[1]) => { order.push('invocation'); return origCreate(c, r); });
    const origClaim = idempotency.claim.bind(idempotency);
    jest.spyOn(idempotency, 'claim').mockImplementation(async (c: TenantContext, s: string, k: Parameters<typeof origClaim>[2], o?: { ttlSeconds?: number }) => { order.push('claim'); return origClaim(c, s, k, o); });
    const { gw } = gateway({ registry, policy: policy(), resolver, invocations, idempotency });
    await gw.execute(request());
    expect(order).toEqual(['invocation', 'claim']);
  });

  it('persists a STARTED attempt (submitted/resultKnown NULL) BEFORE provider boundary', async () => {
    const registry = await registryWith(def());
    const invocations = new InMemoryToolInvocationRepository();
    let attemptAtProviderCall: unknown;
    const { resolver } = provider(async () => {
      // Deep snapshot at the provider boundary — the repo mutates in place.
      const list = await invocations.listAttempts(ctx, 'tc-1');
      attemptAtProviderCall = list.map((a) => ({ ...a }));
      return OK;
    });
    const { gw } = gateway({ registry, policy: policy(), resolver, invocations });
    await gw.execute(request());
    const attempts = attemptAtProviderCall as Array<{ status: string; submitted?: boolean; resultKnown?: boolean }>;
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe('STARTED');
    expect(attempts[0].submitted).toBeUndefined();
    expect(attempts[0].resultKnown).toBeUndefined();
  });

  it('existing COMPLETED claim → idempotent replay, zero provider calls', async () => {
    const registry = await registryWith(def({ idempotencyRequired: true }));
    const { resolver, execute } = provider(OK);
    const idempotency = new InMemoryIdempotencyStore();
    const scope = 'tool:web_search:execute';
    await idempotency.set(ctx, scope, asIdempotencyKey('idem-1'), {
      submitted: true,
      callResult: { toolCallId: 'prior', status: 'SUCCESS', output: { cached: true } },
    }, { status: 'COMPLETED' });
    const { gw } = gateway({ registry, policy: policy(), resolver, idempotency });
    const res = await gw.execute(request());
    expect(res.status).toBe('SUCCESS');
    expect((res.output as { cached: boolean }).cached).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });

  it('existing PENDING claim → OUTCOME_UNKNOWN, zero provider calls (no duplicate side effect)', async () => {
    const registry = await registryWith(def({ idempotencyRequired: true, sideEffectClass: 'IRREVERSIBLE_EXTERNAL' }));
    const { resolver, execute } = provider(OK);
    const idempotency = new InMemoryIdempotencyStore();
    await idempotency.claim(ctx, 'tool:web_search:execute', asIdempotencyKey('idem-1'));
    const { gw } = gateway({ registry, policy: policy(), resolver, idempotency });
    const res = await gw.execute(request());
    expect(res.status).toBe('OUTCOME_UNKNOWN');
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('ToolGateway — ambiguous side-effect safety', () => {
  it('submitted + result lost → OUTCOME_UNKNOWN, no auto-retry for IRREVERSIBLE_EXTERNAL', async () => {
    const registry = await registryWith(def({
      sideEffectClass: 'IRREVERSIBLE_EXTERNAL',
      maxRetries: 3,
    }));
    const ambiguous: ToolProviderOutcome = { submitted: true, resultKnown: false, retryable: true, failureClassification: 'TIMEOUT' };
    const { resolver, execute } = provider(ambiguous);
    const { gw } = gateway({ registry, policy: policy(), resolver });
    const res = await gw.execute(request());
    expect(res.status).toBe('OUTCOME_UNKNOWN');
    expect(execute).toHaveBeenCalledTimes(1); // no auto-retry on ambiguous submission
  });

  it('READ_ONLY ambiguous outcome may retry (no side effect)', async () => {
    const registry = await registryWith(def({ sideEffectClass: 'READ_ONLY', maxRetries: 1 }));
    let calls = 0;
    const { resolver } = provider(async () => {
      calls += 1;
      return calls === 1
        ? { submitted: true, resultKnown: false, retryable: true }
        : OK;
    });
    const { gw } = gateway({ registry, policy: policy(), resolver });
    const res = await gw.execute(request());
    expect(res.status).toBe('SUCCESS');
    expect(calls).toBe(2);
  });

  it('side-effecting tool retries only when submitted=false positively known', async () => {
    const registry = await registryWith(def({ sideEffectClass: 'REVERSIBLE_WRITE', maxRetries: 1 }));
    let calls = 0;
    const { resolver } = provider(async () => {
      calls += 1;
      return calls === 1
        ? { submitted: false, resultKnown: true, retryable: true, failureClassification: 'CONN_REFUSED' }
        : OK;
    });
    const { gw } = gateway({ registry, policy: policy(), resolver });
    const res = await gw.execute(request());
    expect(res.status).toBe('SUCCESS');
    expect(calls).toBe(2);
  });

  it('provider throw after boundary → conservative OUTCOME_UNKNOWN for side-effecting tool', async () => {
    const registry = await registryWith(def({ sideEffectClass: 'IRREVERSIBLE_EXTERNAL', maxRetries: 2 }));
    const { resolver, execute } = provider(async () => { throw new Error('socket reset'); });
    const { gw } = gateway({ registry, policy: policy(), resolver });
    const res = await gw.execute(request());
    expect(res.status).toBe('OUTCOME_UNKNOWN');
    expect(execute).toHaveBeenCalledTimes(1); // no auto-retry on unknown submission
  });
});
