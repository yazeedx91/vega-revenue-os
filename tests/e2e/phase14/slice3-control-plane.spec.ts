import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import type { TenantContext } from '@projectx/domain';
import { NoOpTelemetry, PostgresAuditLog, PostgresClient } from '@projectx/infrastructure';
import { asCorrelationId, asIdempotencyKey, asTenantId, asUserId, type ToolCallRequest, type ToolCallResult } from '@projectx/shared';
import {
  AgentExecutor,
  ContextAssembler,
  InMemoryCheckpointStore,
  FakeImplementationRegistry,
  InMemoryKnowledgeRetriever,
  InMemoryMemoryRetriever,
  PolicyAwareDecisionEngine,
  ToolExecutor,
  StructuredOutputValidator,
  type IReasoningEngine,
  type IOutputValidator,
  type ReasoningRequest,
  type ReasoningOutput,
  type OutputValidationRequest,
  type OutputValidationResult,
} from '@projectx/ai-runtime';
import {
  ControlPlaneAgentRegistry,
  ControlPlanePolicyClient,
  PolicyEvaluationService,
  PostgresAgentRepository,
  PostgresAuditSink,
  PostgresAutonomyRepository,
  PostgresCapabilityRepository,
  PostgresEmergencyStopProvider,
  PostgresModelRepository,
  PostgresPolicyRepository,
} from '@projectx/control-plane';
import { connectPostgres, runMigrations } from './helpers';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const AGENT_ID = 'research-agent';
const CAPABILITY_ID = 'research';

class DeterministicReasoningEngine implements IReasoningEngine {
  async reason(_ctx: TenantContext, _request: ReasoningRequest): Promise<ReasoningOutput> {
    return {
      rationale: 'Slice 3 E2E deterministic reasoning',
      conclusion: 'proceed',
      confidence: 0.9,
      evidence: [],
      requiredApprovals: [],
      proposedActions: [],
    };
  }
}

class DeterministicOutputValidator implements IOutputValidator {
  async validate(_ctx: TenantContext, _request: OutputValidationRequest): Promise<OutputValidationResult> {
    return {
      valid: true,
      piiCheck: 'PASSED',
      safeOutput: _request.proposedOutput,
    };
  }
}

class NoopToolClient {
  async call(request: ToolCallRequest): Promise<ToolCallResult> {
    throw new Error(`No-op tool client cannot execute ${request.toolId}`);
  }
}

describe('Slice 3 Control Plane E2E', () => {
  let pool: Pool | undefined;
  let postgresClient: PostgresClient | undefined;
  let policyClient: ControlPlanePolicyClient | undefined;
  let agentExecutor: AgentExecutor | undefined;

  beforeAll(async () => {
    await runMigrations();
    pool = await connectPostgres();
    postgresClient = new PostgresClient(pool);

    const auditLog = new PostgresAuditLog({ pool });
    const auditSink = new PostgresAuditSink(auditLog);
    const repoConfig = { client: postgresClient };

    const agentRepo = new PostgresAgentRepository(repoConfig);
    const capabilityRepo = new PostgresCapabilityRepository(repoConfig);
    const policyRepo = new PostgresPolicyRepository(repoConfig);
    const autonomyRepo = new PostgresAutonomyRepository(repoConfig);
    const emergencyStopProvider = new PostgresEmergencyStopProvider(repoConfig);

    const policyEvaluation = new PolicyEvaluationService({
      emergencyStopProvider,
      policyRepository: policyRepo,
      autonomyRepository: autonomyRepo,
      auditSink,
    });

    const agentRegistry = new ControlPlaneAgentRegistry({
      agentRepository: agentRepo,
      capabilityRepository: capabilityRepo,
    });
    policyClient = new ControlPlanePolicyClient({ policyEvaluationService: policyEvaluation });

    agentExecutor = new AgentExecutor({
      agentRegistry,
      implementationRegistry: new FakeImplementationRegistry(),
      policyClient,
      contextAssembler: new ContextAssembler({
        memoryRetriever: new InMemoryMemoryRetriever(),
        knowledgeRetriever: new InMemoryKnowledgeRetriever(),
      }),
      memoryRetriever: new InMemoryMemoryRetriever(),
      knowledgeRetriever: new InMemoryKnowledgeRetriever(),
      reasoningEngine: new DeterministicReasoningEngine(),
      decisionEngine: new PolicyAwareDecisionEngine(),
      toolClient: new ToolExecutor(new NoopToolClient() as any, new NoOpTelemetry(), { maxRetries: 0, baseDelayMs: 10 }),
      outputValidator: new DeterministicOutputValidator(),
      telemetry: new NoOpTelemetry(),
      checkpointStore: new InMemoryCheckpointStore(),
    });

    const ctxA: TenantContext = {
      tenantId: asTenantId(TENANT_A),
      correlationId: asCorrelationId(randomUUID()),
      userId: asUserId('tester'),
    };

    await seedGlobalCatalogs(postgresClient);
    await seedTenantAgent(postgresClient, ctxA);

    const ctxB: TenantContext = {
      tenantId: asTenantId(TENANT_B),
      correlationId: asCorrelationId(randomUUID()),
      userId: asUserId('tester'),
    };
    await seedTenantAgent(postgresClient, ctxB);
  });

  beforeEach(async () => {
    if (!postgresClient) return;
    const ctxA = makeContext(TENANT_A);
    const ctxB = makeContext(TENANT_B);
    await postgresClient.withTenant(ctxA, async (client) => {
      await client.query('DELETE FROM control_plane.policies');
      await client.query('DELETE FROM control_plane.emergency_stop');
      await client.query('DELETE FROM control_plane.autonomy_config');
    });
    await postgresClient.withTenant(ctxB, async (client) => {
      await client.query('DELETE FROM control_plane.policies');
      await client.query('DELETE FROM control_plane.emergency_stop');
      await client.query('DELETE FROM control_plane.autonomy_config');
    });
  });

  afterAll(async () => {
    if (postgresClient) {
      const adminCtx = makeContext(TENANT_A);
      await postgresClient.withTenant(adminCtx, async (client) => {
        await client.query(
          `DELETE FROM control_plane.policies
           WHERE policy_id = 'system-hard-deny' AND is_system = true`
        );
      });
      for (const tenant of [TENANT_A, TENANT_B]) {
        const ctx = makeContext(tenant);
        await postgresClient.withTenant(ctx, async (client) => {
          await client.query(
            `DELETE FROM control_plane.agent_versions
             WHERE agent_id = $1
               AND (is_system = true OR tenant_id = current_setting('app.current_tenant', true))`,
            [AGENT_ID],
          );
          await client.query(
            `DELETE FROM control_plane.policies
             WHERE tenant_id = current_setting('app.current_tenant', true)
               AND policy_id IN ($1, $2, $3)`,
            [`${tenant}-allow`, `${tenant}-deny`, `${tenant}-require_approval`],
          );
          await client.query(
            `DELETE FROM control_plane.emergency_stop
             WHERE tenant_id = current_setting('app.current_tenant', true)
               AND stop_id = $1`,
            [`${tenant}-stop`],
          );
        });
      }
    }
    await pool?.end();
  });

  function makeContext(tenant: string): TenantContext {
    return {
      tenantId: asTenantId(tenant),
      correlationId: asCorrelationId(randomUUID()),
      userId: asUserId('tester'),
    };
  }

  async function setPolicy(tenant: string, outcome: string, priority = 10): Promise<void> {
    if (!postgresClient) throw new Error('missing pool');
    const ctx = makeContext(tenant);
    await postgresClient.withTenant(ctx, async (client) => {
      await client.query(
        `DELETE FROM control_plane.policies
         WHERE tenant_id = current_setting('app.current_tenant', true)
           AND capability = $1`,
        [CAPABILITY_ID],
      );
      await client.query(
        `INSERT INTO control_plane.policies
           (policy_id, tenant_id, is_system, scope, capability, risk_category, outcome, policy_version, priority)
         VALUES ($1, current_setting('app.current_tenant', true), false, 'tenant', $2, 'LOW', $3, '1.0.0', $4)
         ON CONFLICT (policy_id) DO UPDATE SET
           outcome = EXCLUDED.outcome,
           priority = EXCLUDED.priority,
           updated_at = NOW()`,
        [`${tenant}-${outcome.toLowerCase()}`, CAPABILITY_ID, outcome, priority],
      );
    });
  }

  async function clearEmergencyStop(tenant: string): Promise<void> {
    if (!postgresClient) throw new Error('missing pool');
    const ctx = makeContext(tenant);
    await postgresClient.withTenant(ctx, async (client) => {
      await client.query(
        `DELETE FROM control_plane.emergency_stop
         WHERE tenant_id = current_setting('app.current_tenant', true)`,
      );
    });
  }

  async function setEmergencyStop(tenant: string): Promise<void> {
    if (!postgresClient) throw new Error('missing pool');
    const ctx = makeContext(tenant);
    await postgresClient.withTenant(ctx, async (client) => {
      await client.query(
        `INSERT INTO control_plane.emergency_stop (stop_id, tenant_id, active)
         VALUES ($1, current_setting('app.current_tenant', true), true)
         ON CONFLICT (stop_id) DO UPDATE SET active = true, updated_at = NOW()`,
        [`${tenant}-stop`],
      );
    });
  }

  async function makeRequest(tenant: string, autonomyLevel = 5, riskCategory = 'LOW') {
    return {
      executionId: randomUUID(),
      tenantId: asTenantId(tenant),
      missionId: randomUUID(),
      agentId: AGENT_ID,
      agentVersion: '1.0.0',
      taskId: randomUUID(),
      taskType: 'execute',
      correlationId: asCorrelationId(randomUUID()),
      idempotencyKey: asIdempotencyKey(randomUUID()),
      context: {},
      capabilities: [CAPABILITY_ID],
      policyContext: {
        autonomyLevel,
        riskCategory,
        tenantPolicyVersion: '1.0.0',
        missionPolicyVersion: '1.0.0',
      },
      budget: { maxTokens: 1000, maxCostUsd: 1, maxDurationSeconds: 60 },
    };
  }

  describe('Policy outcomes through the real Control Plane boundary', () => {
    it('Scenario A → ALLOW', async () => {
      await setPolicy(TENANT_A, 'ALLOW');
      const request = await makeRequest(TENANT_A, 5, 'LOW');
      const result = await agentExecutor!.execute(request);
      expect(result.status).toBe('COMPLETED');
    });

    it('Scenario B → REQUIRE_APPROVAL via policy ceiling', async () => {
      await setPolicy(TENANT_A, 'REQUIRE_APPROVAL');
      const request = await makeRequest(TENANT_A, 5, 'LOW');
      const result = await agentExecutor!.execute(request);
      expect(result.status).toBe('AWAITING_APPROVAL');
    });

    it('Scenario C → DENY', async () => {
      await setPolicy(TENANT_A, 'DENY');
      const request = await makeRequest(TENANT_A, 5, 'LOW');
      const result = await agentExecutor!.execute(request);
      expect(result.status).toBe('FAILED');
    });

    it('emergency stop forces DENY', async () => {
      await setPolicy(TENANT_A, 'ALLOW');
      await setEmergencyStop(TENANT_A);
      const request = await makeRequest(TENANT_A, 5, 'LOW');
      const result = await agentExecutor!.execute(request);
      expect(result.status).toBe('FAILED');
      await clearEmergencyStop(TENANT_A);
    });

    it('expired PolicyDecision requires re-evaluation', async () => {
      await setPolicy(TENANT_A, 'ALLOW');
      const ctx = makeContext(TENANT_A);
      const request = await makeRequest(TENANT_A, 5, 'LOW');
      const first = await policyClient!.evaluate(ctx, request);
      const second = await policyClient!.evaluate(ctx, request);
      expect(second.decisionId).not.toBe(first.decisionId);
      expect(second.evaluatedAt.getTime()).toBeGreaterThanOrEqual(first.evaluatedAt.getTime());
      expect(second.expiresAt.getTime()).toBeGreaterThan(second.evaluatedAt.getTime());
    });
  });

  describe('Tenant isolation', () => {
    it('Tenant A policies are invisible to Tenant B', async () => {
      await setPolicy(TENANT_A, 'DENY');
      await setPolicy(TENANT_B, 'ALLOW');

      const requestA = await makeRequest(TENANT_A, 5, 'LOW');
      const requestB = await makeRequest(TENANT_B, 5, 'LOW');

      const resultA = await policyClient!.evaluate(makeContext(TENANT_A), requestA);
      const resultB = await policyClient!.evaluate(makeContext(TENANT_B), requestB);

      expect(resultA.outcome).toBe('DENY');
      expect(resultB.outcome).toBe('ALLOW');
    });

    it('global system policies apply to all tenants', async () => {
      if (!postgresClient) throw new Error('missing pool');
      const adminCtx: TenantContext = {
        tenantId: asTenantId(TENANT_A),
        correlationId: asCorrelationId(randomUUID()),
        userId: asUserId('tester'),
      };
      await postgresClient.withTenant(adminCtx, async (client) => {
        await client.query(
          `INSERT INTO control_plane.policies
             (policy_id, tenant_id, is_system, scope, capability, risk_category, outcome, policy_version, priority)
           VALUES ('system-hard-deny', null, true, 'system', $1, 'LOW', 'DENY', '1.0.0', 0)
           ON CONFLICT (policy_id) DO UPDATE SET
             outcome = EXCLUDED.outcome,
             updated_at = NOW()`,
          [CAPABILITY_ID],
        );
      });

      const requestB = await makeRequest(TENANT_B, 5, 'LOW');
      const resultB = await policyClient!.evaluate(makeContext(TENANT_B), requestB);
      expect(resultB.outcome).toBe('DENY');
    });
  });
});

async function seedGlobalCatalogs(client: PostgresClient): Promise<void> {
  await client.query(
    `INSERT INTO control_plane.capabilities
       (capability_id, name, description, risk_category, allowed_tools, required_policies, version)
     VALUES ($1, $2, $3, $4, $5, $6, '1.0.0')
     ON CONFLICT (capability_id) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       risk_category = EXCLUDED.risk_category,
       allowed_tools = EXCLUDED.allowed_tools,
       required_policies = EXCLUDED.required_policies,
       updated_at = NOW()`,
    [
      CAPABILITY_ID,
      'Research',
      'Research capability',
      'LOW',
      ['{}'],
      ['{}'],
    ],
  );
}

async function seedTenantAgent(client: PostgresClient, ctx: TenantContext): Promise<void> {
  await client.withTenant(ctx, async (c) => {
    await c.query(
      `DELETE FROM control_plane.agent_versions
       WHERE agent_id = $1
         AND (is_system = true OR tenant_id = current_setting('app.current_tenant', true))`,
      [AGENT_ID],
    );
    await c.query(
      `INSERT INTO control_plane.agent_versions
         (version_id, agent_id, tenant_id, is_system, version, lifecycle, name, role, description,
          capabilities, tools, policies, model_policy, memory_policy, knowledge_policy,
          autonomy_level_default, evaluation_policy, owner, implementation_key, created_at, updated_at)
       VALUES ($1, $2, current_setting('app.current_tenant', true), false, $3, $4, $5, $6, $7,
              $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), NOW())
       ON CONFLICT (version_id) DO UPDATE SET
         lifecycle = EXCLUDED.lifecycle,
         implementation_key = EXCLUDED.implementation_key,
         updated_at = NOW()`,
      [
        `${ctx.tenantId}:${AGENT_ID}:1.0.0`,
        AGENT_ID,
        '1.0.0',
        'ACTIVE',
        'Research Agent',
        'researcher',
        'A research agent for Slice 3',
        [CAPABILITY_ID],
        [],
        JSON.stringify([]),
        JSON.stringify({}),
        JSON.stringify({}),
        JSON.stringify({}),
        5,
        JSON.stringify({}),
        'slice3-test',
        'fake.agent.v1',
      ],
    );
  });
}


