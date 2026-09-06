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
       timeout_seconds, max_retries, idempotency_required, lifecycle)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      def.toolDefinitionId, def.toolId, def.version, def.tenantId, def.description,
      def.requiredCapabilities, def.riskCategory, def.sideEffectClass, def.requiredApproval,
      def.providerId, def.enabled, def.timeoutSeconds, def.maxRetries,
      def.idempotencyRequired, def.lifecycle,
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

beforeEach(() => { providerCalls = 0; });

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
