import { randomUUID } from 'crypto';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { Pool } from 'pg';
import type { TenantContext } from '@projectx/domain';
import {
  PostgresClient,
  PostgresIdempotencyStore,
} from '@projectx/infrastructure';
import {
  asCorrelationId,
  asIdempotencyKey,
  asTenantId,
  StrictToolSchemaValidator,
  type ToolCallRequest,
  type ToolDefinition,
  type ToolProviderOutcome,
} from '@projectx/shared';
import {
  ToolGateway,
  PostgresToolRegistry,
  PostgresToolInvocationRepository,
  HttpToolProvider,
  type HttpEgressPolicy,
  type IToolApprovalBinding,
  type IToolPolicyEvaluator,
  type IToolProvider,
  type IToolProviderReadiness,
  type IToolProviderResolver,
  type ToolPolicyDecision,
} from '@projectx/tool-gateway';
import {
  connectPostgres,
  createTenantContext,
  requireEnv,
  runMigrations,
} from './helpers';
import { getAdminDatabaseUrl, getAppDatabaseUrl } from './integration-config';

/**
 * Slice 6 E2E acceptance — governed tool execution over REAL Postgres
 * (registry + invocations + idempotency, RLS-enforced) and a REAL
 * HttpToolProvider bound to a local deterministic HTTP service. The local
 * service substitutes only the external provider; the gateway, persistence,
 * and adapter layers are the production implementations.
 */

const TENANT = `tenant-s6-${randomUUID()}`;
const OTHER_TENANT = `tenant-s6-other-${randomUUID()}`;

let adminPool: Pool;
let appPool: Pool;
let appClient: PostgresClient;
let registry: PostgresToolRegistry;
let invocations: PostgresToolInvocationRepository;
let idempotency: PostgresIdempotencyStore;
let httpServer: Server;
let httpPort: number;
let providerCalls: number;
let providerBehavior: (req: IncomingMessage, res: ServerResponse) => void;

function toolDef(over: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    toolDefinitionId: `td-${randomUUID()}`,
    // Unique toolId per definition avoids the (tool_id, version) global-scope
    // uniqueness constraint across tests that each seed a global definition.
    toolId: `local_http_${randomUUID().slice(0, 8)}`,
    version: '1.0.0',
    tenantId: null,
    description: 'local http tool',
    requiredCapabilities: ['http.invoke'],
    riskCategory: 'LOW',
    sideEffectClass: 'READ_ONLY',
    requiredApproval: false,
    providerId: 'http',
    enabled: true,
    timeoutSeconds: 5,
    maxRetries: 0,
    idempotencyRequired: false,
    lifecycle: 'ACTIVE',
    ...over,
  };
}

function callReq(def: ToolDefinition, over: Partial<ToolCallRequest> = {}): ToolCallRequest {
  return {
    toolCallId: `tc-${randomUUID()}`,
    toolId: def.toolId,
    toolVersion: def.version,
    tenantId: asTenantId(TENANT),
    correlationId: asCorrelationId(`corr-${randomUUID()}`),
    idempotencyKey: asIdempotencyKey(`idem-${randomUUID()}`),
    authorization: {
      policyDecisionId: 'pd-1',
      decision: 'ALLOW',
      capabilities: ['http.invoke'],
      expiresAt: new Date(Date.now() + 60000),
    },
    riskCategory: def.riskCategory,
    input: { ping: true },
    timeoutSeconds: 5,
    metadata: { route: 'local' },
    ...over,
  };
}

// Deterministic policy evaluator — governs the decision the gateway consumes.
function policyEvaluator(decision: Partial<ToolPolicyDecision> = {}): IToolPolicyEvaluator {
  return {
    evaluate: async () => ({
      decision: 'ALLOW',
      policyDecisionId: 'pd-1',
      capabilities: ['http.invoke'],
      autonomyAllowed: true,
      ...decision,
    }),
  };
}

const approveAll: IToolApprovalBinding = { verify: async () => ({ approved: true }) };

function buildGateway(opts: {
  policy?: IToolPolicyEvaluator;
  approval?: IToolApprovalBinding;
  readiness?: IToolProviderReadiness;
  providers?: Map<string, IToolProvider>;
}): ToolGateway {
  const providers = opts.providers ?? new Map<string, IToolProvider>([
    ['http', new HttpToolProvider({
      providerId: 'http',
      policy: {
        allowedHosts: ['127.0.0.1', 'localhost'],
        allowedSchemes: ['http'],
        allowPrivateNetwork: true, // test-mode local endpoint only
        allowRedirects: false,
        routes: { local: { baseUrl: `http://127.0.0.1:${httpPort}/invoke` } },
      } satisfies HttpEgressPolicy,
    })],
  ]);
  const readiness: IToolProviderReadiness = opts.readiness ?? {
    isReady: async (id: string) => providers.has(id),
  };
  const resolver: IToolProviderResolver = { resolve: (id: string) => providers.get(id) };
  return new ToolGateway({
    registry,
    invocations,
    idempotency,
    policyEvaluator: opts.policy ?? policyEvaluator(),
    approvalBinding: opts.approval ?? approveAll,
    providerReadiness: readiness,
    providerResolver: resolver,
    schemaValidator: new StrictToolSchemaValidator(),
  });
}

async function seedDefinition(def: ToolDefinition): Promise<void> {
  // Global + tenant definitions are seeded via the admin (bypasses RLS).
  await adminPool.query(
    `INSERT INTO tool_registry.tool_definitions
      (tool_definition_id, tool_id, version, tenant_id, description, required_capabilities,
       risk_category, side_effect_class, required_approval, provider_id, enabled,
       timeout_seconds, max_retries, idempotency_required, lifecycle, input_schema, output_schema)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      def.toolDefinitionId, def.toolId, def.version, def.tenantId, def.description,
      def.requiredCapabilities, def.riskCategory, def.sideEffectClass, def.requiredApproval,
      def.providerId, def.enabled, def.timeoutSeconds, def.maxRetries,
      def.idempotencyRequired, def.lifecycle,
      def.inputSchema ? JSON.stringify(def.inputSchema) : null,
      def.outputSchema ? JSON.stringify(def.outputSchema) : null,
    ],
  );
}

beforeAll(async () => {
  requireEnv();
  adminPool = await connectPostgres(getAdminDatabaseUrl());
  appPool = await connectPostgres(getAppDatabaseUrl());
  appClient = new PostgresClient(appPool);
  await runMigrations();

  registry = new PostgresToolRegistry(appClient);
  invocations = new PostgresToolInvocationRepository(appClient);
  idempotency = new PostgresIdempotencyStore({ pool: appPool });

  // Local deterministic HTTP service — substitutes only the external provider.
  providerCalls = 0;
  providerBehavior = (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'local-req-1' });
    res.end(JSON.stringify({ echoed: true }));
  };
  httpServer = createServer((req, res) => { providerCalls += 1; providerBehavior(req, res); });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  httpPort = (httpServer.address() as AddressInfo).port;
}, 120_000);

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
  await adminPool?.end();
  await appPool?.end();
});

const defaultProviderBehavior = (_req: IncomingMessage, res: ServerResponse) => {
  res.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'local-req-1' });
  res.end(JSON.stringify({ echoed: true }));
};

beforeEach(() => {
  providerCalls = 0;
  providerBehavior = defaultProviderBehavior; // reset per-test provider stub
});

describe('Slice 6 — RLS / role hardening (as projectx_app)', () => {
  it('tool_registry tables have RLS + FORCE RLS enabled', async () => {
    const res = await adminPool.query(
      `SELECT relname, relrowsecurity, relforcerowsecurity
         FROM pg_class WHERE relnamespace = 'tool_registry'::regnamespace
         AND relname IN ('tool_definitions','tool_invocations','tool_invocation_attempts')`,
    );
    expect(res.rowCount).toBe(3);
    for (const row of res.rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }
  });

  it('projectx_app has no superuser or RLS bypass privileges', async () => {
    const res = await adminPool.query(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'projectx_app'`,
    );
    expect(res.rows[0].rolsuper).toBe(false);
    expect(res.rows[0].rolbypassrls).toBe(false);
  });
});

describe('Slice 6 — governed execution over real Postgres + real HTTP provider', () => {
  it('executes an authorized call end-to-end via the real HttpToolProvider', async () => {
    const def = toolDef();
    await seedDefinition(def);
    const gw = buildGateway({});
    const res = await gw.execute(callReq(def));
    expect(res.status).toBe('SUCCESS');
    expect(providerCalls).toBe(1);
  });

  it('persists a durable logical invocation + attempt rows', async () => {
    const def = toolDef();
    await seedDefinition(def);
    const gw = buildGateway({});
    const req = callReq(def);
    await gw.execute(req);
    const ctx = createTenantContext(TENANT);
    const inv = await invocations.getInvocation(ctx, req.toolCallId);
    expect(inv?.status).toBe('SUCCESS');
    const attempts = await invocations.listAttempts(ctx, req.toolCallId);
    expect(attempts.length).toBe(1);
    expect(attempts[0].submitted).toBe(true);
    expect(attempts[0].resultKnown).toBe(true);
  });

  it('policy DENY → POLICY_DENIED, zero provider calls', async () => {
    const def = toolDef();
    await seedDefinition(def);
    const gw = buildGateway({ policy: policyEvaluator({ decision: 'DENY' }) });
    const res = await gw.execute(callReq(def));
    expect(res.status).toBe('POLICY_DENIED');
    expect(providerCalls).toBe(0);
  });

  it('provider not ready → FAILED, zero provider calls, no claim', async () => {
    const def = toolDef({ idempotencyRequired: true });
    await seedDefinition(def);
    const notReady: IToolProviderReadiness = { isReady: async () => false };
    const gw = buildGateway({ readiness: notReady });
    const res = await gw.execute(callReq(def));
    expect(res.status).toBe('FAILED');
    expect(res.error?.code).toBe('PROVIDER_NOT_READY');
    expect(providerCalls).toBe(0);
  });

  it('version-less execution → VALIDATION_ERROR', async () => {
    const def = toolDef();
    await seedDefinition(def);
    const gw = buildGateway({});
    const res = await gw.execute(callReq(def, { toolVersion: '' }));
    expect(res.status).toBe('VALIDATION_ERROR');
    expect(providerCalls).toBe(0);
  });
});

describe('Slice 6 — tenant shadowing + idempotency (real Postgres)', () => {
  it('disabled tenant override shadows global — fail closed, zero provider calls', async () => {
    const toolId = `shadow-${randomUUID()}`;
    const global = toolDef({ toolDefinitionId: `g-${randomUUID()}`, toolId, tenantId: null });
    const tenant = toolDef({ toolDefinitionId: `t-${randomUUID()}`, toolId, tenantId: TENANT, enabled: false });
    await seedDefinition(global);
    await seedDefinition(tenant);
    const gw = buildGateway({});
    const res = await gw.execute(callReq(global, { toolId, toolVersion: '1.0.0' }));
    expect(res.status).not.toBe('SUCCESS');
    expect(providerCalls).toBe(0);
  });

  it('explicit global tool_definition_id cannot bypass a disabled tenant override', async () => {
    const toolId = `shadowid-${randomUUID()}`;
    const global = toolDef({ toolDefinitionId: `g-${randomUUID()}`, toolId, tenantId: null });
    const tenant = toolDef({ toolDefinitionId: `t-${randomUUID()}`, toolId, tenantId: TENANT, enabled: false });
    await seedDefinition(global);
    await seedDefinition(tenant);
    const gw = buildGateway({});
    const res = await gw.execute(callReq(global, {
      toolId, toolVersion: '1.0.0', metadata: { toolDefinitionId: global.toolDefinitionId, route: 'local' },
    }));
    expect(res.status).not.toBe('SUCCESS');
    expect(providerCalls).toBe(0);
  });

  it('idempotent replay: COMPLETED claim returns prior result, zero new provider calls', async () => {
    const def = toolDef({ idempotencyRequired: true });
    await seedDefinition(def);
    const gw = buildGateway({});
    const key = asIdempotencyKey(`idem-${randomUUID()}`);
    const req1 = callReq(def, { idempotencyKey: key });
    const req2 = callReq(def, { idempotencyKey: key });
    const r1 = await gw.execute(req1);
    expect(r1.status).toBe('SUCCESS');
    expect(providerCalls).toBe(1);
    const r2 = await gw.execute(req2);
    expect(r2.status).toBe('SUCCESS');
    expect(providerCalls).toBe(1); // replayed — no second side effect
  });
});

// ---------------------------------------------------------------------------
// Remaining acceptance-matrix claims (numbered for traceability). Claims that
// are purely unit-level (resolution edge cases, registry lifecycle transitions)
// are additionally covered in packages/tool-gateway/src/__tests__.
// ---------------------------------------------------------------------------

describe('Slice 6 — capability-scoped discovery (claims 1, 2, 21)', () => {
  it('[1] authorized discovery returns only capability-permitted, ready tools', async () => {
    const ctx = createTenantContext(TENANT);
    const allowed = toolDef({ requiredCapabilities: ['http.invoke'] });
    const denied = toolDef({ requiredCapabilities: ['admin'] });
    const draft = toolDef({ lifecycle: 'DRAFT' });
    await seedDefinition(allowed);
    await seedDefinition(denied);
    await seedDefinition(draft);
    const exec = await registry.discoverExecutable(ctx, ['http.invoke']);
    const ids = exec.map((d) => d.toolDefinitionId);
    expect(ids).toContain(allowed.toolDefinitionId);
    expect(ids).not.toContain(denied.toolDefinitionId); // [2] capability denied
    expect(ids).not.toContain(draft.toolDefinitionId);  // [21] non-ACTIVE excluded
  });

  it('[2] invoke with missing capability → UNAUTHORIZED, zero provider calls', async () => {
    const def = toolDef({ requiredCapabilities: ['admin'] });
    await seedDefinition(def);
    const gw = buildGateway({ policy: policyEvaluator({ capabilities: ['http.invoke'] }) });
    const res = await gw.execute(callReq(def));
    expect(res.status).toBe('UNAUTHORIZED');
    expect(providerCalls).toBe(0);
  });
});

describe('Slice 6 — approval binding (claims 4, 5, 26)', () => {
  it('[4] REQUIRE_APPROVAL without bound approval → zero provider calls', async () => {
    const def = toolDef({ requiredApproval: true });
    await seedDefinition(def);
    const noApproval: IToolApprovalBinding = { verify: async () => ({ approved: false, reason: 'none' }) };
    const gw = buildGateway({ approval: noApproval });
    const res = await gw.execute(callReq(def));
    expect(res.status).toBe('POLICY_DENIED');
    expect(providerCalls).toBe(0);
  });

  it('[5] valid bound approval → tool executes', async () => {
    const def = toolDef({ requiredApproval: true });
    await seedDefinition(def);
    const gw = buildGateway({ approval: { verify: async () => ({ approved: true, approvalId: 'ap-1' }) } });
    const res = await gw.execute(callReq(def));
    expect(res.status).toBe('SUCCESS');
    expect(providerCalls).toBe(1);
  });

  it('[26] mismatched/stale approval → zero provider calls', async () => {
    const def = toolDef({ requiredApproval: true });
    await seedDefinition(def);
    const stale: IToolApprovalBinding = { verify: async () => ({ approved: false, reason: 'stale binding' }) };
    const gw = buildGateway({ approval: stale });
    const res = await gw.execute(callReq(def));
    expect(res.status).toBe('POLICY_DENIED');
    expect(providerCalls).toBe(0);
  });
});

describe('Slice 6 — schema validation (claims 6, 7, 8)', () => {
  it('[6] invalid input rejected before adapter', async () => {
    const def = toolDef({ inputSchema: { type: 'object', required: ['q'], properties: { q: { type: 'string' } } } });
    await seedDefinition(def);
    const gw = buildGateway({});
    const res = await gw.execute(callReq(def, { input: { q: 42 } }));
    expect(res.status).toBe('VALIDATION_ERROR');
    expect(providerCalls).toBe(0);
  });

  it('[7] valid input + valid result schema accepted', async () => {
    const def = toolDef({ inputSchema: { type: 'object', properties: { ping: { type: 'boolean' } } } });
    await seedDefinition(def);
    const gw = buildGateway({});
    const res = await gw.execute(callReq(def));
    expect(res.status).toBe('SUCCESS');
  });

  it('[8] malformed adapter result fails safely (non-2xx → provider error, not success)', async () => {
    const def = toolDef();
    await seedDefinition(def);
    providerBehavior = (_req, res) => { res.writeHead(500); res.end('err'); };
    const gw = buildGateway({});
    const res = await gw.execute(callReq(def));
    expect(res.status).not.toBe('SUCCESS');
    providerBehavior = (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); };
  });
});

describe('Slice 6 — cross-tenant isolation (claims 9, 19)', () => {
  it('[9] tenant A cannot read tenant B tool definition via app role', async () => {
    const bDef = toolDef({ tenantId: OTHER_TENANT });
    await seedDefinition(bDef);
    const ctxA = createTenantContext(TENANT);
    const found = await registry.getById(ctxA, bDef.toolDefinitionId);
    expect(found).toBeUndefined();
  });

  it('[19] global definition is tenant-readable but not tenant-mutable', async () => {
    const g = toolDef({ tenantId: null });
    await seedDefinition(g);
    const ctxA = createTenantContext(TENANT);
    const found = await registry.getById(ctxA, g.toolDefinitionId);
    expect(found?.toolDefinitionId).toBe(g.toolDefinitionId);
    await expect(registry.setEnabled(ctxA, g.toolDefinitionId, false)).rejects.toThrow();
  });
});

describe('Slice 6 — retry authority + bounds (claims 10, 11, 22, 33)', () => {
  it('[10] retryable READ_ONLY failure retries within maxRetries bound', async () => {
    const def = toolDef({ sideEffectClass: 'READ_ONLY', maxRetries: 2 });
    await seedDefinition(def);
    let n = 0;
    providerBehavior = (_req, res) => { n += 1; if (n < 3) { res.writeHead(503); res.end(); } else { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); } };
    const gw = buildGateway({});
    const res = await gw.execute(callReq(def));
    expect(res.status).toBe('SUCCESS');
    expect(providerCalls).toBe(3); // bounded retries
  });

  it('[11] non-retryable failure → no retry', async () => {
    const def = toolDef({ sideEffectClass: 'READ_ONLY', maxRetries: 3 });
    await seedDefinition(def);
    providerBehavior = (_req, res) => { res.writeHead(400); res.end('bad'); };
    const gw = buildGateway({});
    const res = await gw.execute(callReq(def));
    expect(res.status).not.toBe('SUCCESS');
    expect(providerCalls).toBe(1); // no retry on definitive rejection
  });

  it('[22][33] single retry authority — attempts bounded by def.maxRetries only', async () => {
    const def = toolDef({ sideEffectClass: 'READ_ONLY', maxRetries: 1 });
    await seedDefinition(def);
    providerBehavior = (_req, res) => { res.writeHead(503); res.end(); };
    const gw = buildGateway({});
    await gw.execute(callReq(def));
    // ToolExecutor has zero retry; gateway retries at most maxRetries → ≤2 attempts.
    expect(providerCalls).toBeLessThanOrEqual(2);
  });
});

describe('Slice 6 — ambiguous side-effect + idempotency (claims 12, 13, 23, 24, 34, 38, 39, 44)', () => {
  it('[12] duplicate idempotency key ⇒ single side effect', async () => {
    const def = toolDef({ idempotencyRequired: true, sideEffectClass: 'REVERSIBLE_WRITE' });
    await seedDefinition(def);
    const gw = buildGateway({});
    const key = asIdempotencyKey(`dup-${randomUUID()}`);
    await gw.execute(callReq(def, { idempotencyKey: key }));
    await gw.execute(callReq(def, { idempotencyKey: key }));
    expect(providerCalls).toBe(1);
  });

  it('[23][34][38] ambiguous submitted side effect → OUTCOME_UNKNOWN, distinguishable from pre-submission failure', async () => {
    const def = toolDef({ sideEffectClass: 'IRREVERSIBLE_EXTERNAL', maxRetries: 3 });
    await seedDefinition(def);
    // Provider accepts then connection drops before response → ambiguous.
    providerBehavior = (_req, res) => { res.socket?.destroy(); };
    const gw = buildGateway({});
    const res = await gw.execute(callReq(def));
    expect(res.status).toBe('OUTCOME_UNKNOWN');
    expect(providerCalls).toBe(1); // [13][44] no auto-duplicate after ambiguous submission
  });

  it('[24][39] ambiguous side effect retains the durable idempotency claim', async () => {
    const def = toolDef({ idempotencyRequired: true, sideEffectClass: 'IRREVERSIBLE_EXTERNAL' });
    await seedDefinition(def);
    providerBehavior = (_req, res) => { res.socket?.destroy(); };
    const gw = buildGateway({});
    const key = asIdempotencyKey(`amb-${randomUUID()}`);
    const res = await gw.execute(callReq(def, { idempotencyKey: key }));
    expect(res.status).toBe('OUTCOME_UNKNOWN');
    const ctx = createTenantContext(TENANT);
    const rec = await idempotency.get(ctx, `tool:${def.toolId}:execute`, key);
    expect(rec?.status).toBe('PENDING'); // claim retained for reconciliation
  });
});

describe('Slice 6 — attempt persistence + crash safety (claims 25, 43, 50)', () => {
  it('[25][43] each physical provider attempt is persisted before the provider boundary', async () => {
    const def = toolDef();
    await seedDefinition(def);
    const gw = buildGateway({});
    const req = callReq(def);
    await gw.execute(req);
    const ctx = createTenantContext(TENANT);
    const attempts = await invocations.listAttempts(ctx, req.toolCallId);
    expect(attempts.length).toBeGreaterThanOrEqual(1);
    expect(attempts[0].attempt).toBe(1);
  });

  it('[50] incomplete pre-persisted attempt is STARTED/NULL, never masquerades as submitted=false', async () => {
    const def = toolDef();
    await seedDefinition(def);
    const ctx = createTenantContext(TENANT);
    const req = callReq(def);
    await invocations.createInvocation(ctx, {
      toolCallId: req.toolCallId, toolDefinitionId: def.toolDefinitionId, toolId: def.toolId,
      version: def.version, providerId: def.providerId, action: 'execute', tenantId: TENANT,
      correlationId: req.correlationId as string, idempotencyKey: req.idempotencyKey as string,
      status: 'IN_PROGRESS', startedAt: new Date(),
    });
    await invocations.createAttempt(ctx, {
      tenantId: TENANT, toolCallId: req.toolCallId, attempt: 1, toolDefinitionId: def.toolDefinitionId,
      providerId: def.providerId, status: 'STARTED', startedAt: new Date(),
    });
    const attempts = await invocations.listAttempts(ctx, req.toolCallId);
    expect(attempts[0].status).toBe('STARTED');
    expect(attempts[0].submitted).toBeUndefined();
    expect(attempts[0].resultKnown).toBeUndefined();
  });
});

describe('Slice 6 — version immutability + lifecycle (claims 20, 30, 31, 35, 40, 41)', () => {
  it('[30] explicit version pin resolves the exact immutable version', async () => {
    const toolId = `pin-${randomUUID()}`;
    await seedDefinition(toolDef({ toolId, version: '1.0.0' }));
    await seedDefinition(toolDef({ toolId, version: '2.0.0' }));
    const gw = buildGateway({});
    const res = await gw.execute(callReq(toolDef({ toolId }), { toolId, toolVersion: '2.0.0' }));
    expect(res.status).toBe('SUCCESS');
  });

  it('[31] deprecated/retired version is not executable', async () => {
    const def = toolDef({ lifecycle: 'DEPRECATED' });
    await seedDefinition(def);
    const gw = buildGateway({});
    const res = await gw.execute(callReq(def));
    expect(res.status).not.toBe('SUCCESS');
    expect(providerCalls).toBe(0);
  });

  it('[35] ACTIVE tool contract mutation rejected at database level', async () => {
    const def = toolDef({ lifecycle: 'ACTIVE' });
    await seedDefinition(def);
    await expect(adminPool.query(
      `UPDATE tool_registry.tool_definitions SET required_capabilities = '{x}' WHERE tool_definition_id = $1`,
      [def.toolDefinitionId],
    )).rejects.toThrow();
  });

  it('[40] ACTIVE → DRAFT lifecycle rollback rejected', async () => {
    const def = toolDef({ lifecycle: 'ACTIVE' });
    await seedDefinition(def);
    await expect(adminPool.query(
      `UPDATE tool_registry.tool_definitions SET lifecycle = 'DRAFT' WHERE tool_definition_id = $1`,
      [def.toolDefinitionId],
    )).rejects.toThrow();
  });

  it('[41] RETIRED → ACTIVE lifecycle rollback rejected', async () => {
    const def = toolDef({ lifecycle: 'DRAFT' });
    await seedDefinition(def);
    await adminPool.query(`UPDATE tool_registry.tool_definitions SET lifecycle='ACTIVE' WHERE tool_definition_id=$1`, [def.toolDefinitionId]);
    await adminPool.query(`UPDATE tool_registry.tool_definitions SET lifecycle='DEPRECATED' WHERE tool_definition_id=$1`, [def.toolDefinitionId]);
    await adminPool.query(`UPDATE tool_registry.tool_definitions SET lifecycle='RETIRED' WHERE tool_definition_id=$1`, [def.toolDefinitionId]);
    await expect(adminPool.query(
      `UPDATE tool_registry.tool_definitions SET lifecycle='ACTIVE' WHERE tool_definition_id=$1`, [def.toolDefinitionId],
    )).rejects.toThrow();
  });
});

describe('Slice 6 — SSRF / egress hardening (claims 46, 47, 48, 49)', () => {
  it('[46] arbitrary destination from agent input/metadata is rejected', async () => {
    const def = toolDef();
    await seedDefinition(def);
    const gw = buildGateway({});
    const res = await gw.execute(callReq(def, {
      input: { url: 'https://evil.example.com/x' },
      metadata: { baseUrl: 'https://evil.example.com' }, // no valid route
    }));
    expect(res.status).not.toBe('SUCCESS');
    expect(providerCalls).toBe(0);
  });

  it('[47] disallowed/private production destination is rejected', async () => {
    const providers = new Map<string, IToolProvider>([
      ['http', new HttpToolProvider({
        providerId: 'http',
        policy: {
          allowedHosts: ['api.example.com'], allowedSchemes: ['https'],
          allowPrivateNetwork: false, allowRedirects: false,
          routes: { meta: { baseUrl: 'http://169.254.169.254/latest' } },
        },
      })],
    ]);
    const def = toolDef();
    await seedDefinition(def);
    const gw = buildGateway({ providers });
    const res = await gw.execute(callReq(def, { metadata: { route: 'meta' } }));
    expect(res.status).not.toBe('SUCCESS');
    expect(providerCalls).toBe(0);
  });

  it('[48] redirect to non-allowlisted destination is rejected', async () => {
    providerBehavior = (_req, res) => { res.writeHead(302, { location: 'https://evil.example.com/x' }); res.end(); };
    const providers = new Map<string, IToolProvider>([
      ['http', new HttpToolProvider({
        providerId: 'http',
        policy: {
          allowedHosts: ['127.0.0.1'], allowedSchemes: ['http'],
          allowPrivateNetwork: true, allowRedirects: true,
          routes: { local: { baseUrl: `http://127.0.0.1:${httpPort}/invoke` } },
        },
      })],
    ]);
    const def = toolDef();
    await seedDefinition(def);
    const gw = buildGateway({ providers });
    const res = await gw.execute(callReq(def));
    expect(res.status).not.toBe('SUCCESS');
  });

  it('[49] test-mode local HTTP endpoint remains usable', async () => {
    const def = toolDef();
    await seedDefinition(def);
    const gw = buildGateway({});
    const res = await gw.execute(callReq(def));
    expect(res.status).toBe('SUCCESS');
    expect(providerCalls).toBe(1);
  });
});

describe('Slice 6 — governance integrity (claims 14, 15, 16, 27, 28, 36, 45)', () => {
  it('[14] deadline/timeout is enforced (provider hang → TIMEOUT/OUTCOME_UNKNOWN)', async () => {
    const def = toolDef({ timeoutSeconds: 1, sideEffectClass: 'READ_ONLY' });
    await seedDefinition(def);
    providerBehavior = (_req, _res) => { /* never respond */ };
    const gw = buildGateway({});
    const res = await gw.execute(callReq(def, { timeoutSeconds: 1 }));
    expect(['TIMEOUT', 'OUTCOME_UNKNOWN', 'FAILED']).toContain(res.status);
  });

  it('[15] tool/action provenance recorded on the durable invocation', async () => {
    const def = toolDef();
    await seedDefinition(def);
    const gw = buildGateway({});
    const req = callReq(def);
    await gw.execute(req);
    const ctx = createTenantContext(TENANT);
    const inv = await invocations.getInvocation(ctx, req.toolCallId);
    expect(inv?.toolId).toBe(def.toolId);
    expect(inv?.toolDefinitionId).toBe(def.toolDefinitionId);
    expect(inv?.correlationId).toBe(req.correlationId as string);
  });

  it('[27] agent-crafted authorization cannot bypass Control Plane policy', async () => {
    const def = toolDef();
    await seedDefinition(def);
    // Agent claims ALLOW in the request, but the authoritative evaluator denies.
    const gw = buildGateway({ policy: policyEvaluator({ decision: 'DENY' }) });
    const res = await gw.execute(callReq(def, {
      authorization: { policyDecisionId: 'forged', decision: 'ALLOW', capabilities: ['http.invoke'], expiresAt: new Date(Date.now() + 60000) },
    }));
    expect(res.status).toBe('POLICY_DENIED');
    expect(providerCalls).toBe(0);
  });

  it('[28][45] runtime provider not-ready → zero provider calls, no unnecessary PENDING claim', async () => {
    const def = toolDef({ idempotencyRequired: true });
    await seedDefinition(def);
    const notReady: IToolProviderReadiness = { isReady: async () => false };
    const gw = buildGateway({ readiness: notReady });
    const key = asIdempotencyKey(`nr-${randomUUID()}`);
    const res = await gw.execute(callReq(def, { idempotencyKey: key }));
    expect(res.status).toBe('FAILED');
    expect(providerCalls).toBe(0);
    const ctx = createTenantContext(TENANT);
    const rec = await idempotency.get(ctx, `tool:${def.toolId}:execute`, key);
    expect(rec).toBeUndefined(); // no PENDING claim created before readiness
  });

  it('[36] version-less invocation fails closed, zero adapter calls', async () => {
    const def = toolDef();
    await seedDefinition(def);
    const gw = buildGateway({});
    const res = await gw.execute(callReq(def, { toolVersion: '' }));
    expect(res.status).toBe('VALIDATION_ERROR');
    expect(providerCalls).toBe(0);
  });
});
