import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import type { TenantContext } from '@projectx/domain';
import { NoOpTelemetry, PostgresClient } from '@projectx/infrastructure';
import {
  asCorrelationId,
  asIdempotencyKey,
  asTenantId,
  asUserId,
  type AIExecutionRequest,
  type ToolCallRequest,
  type ToolCallResult,
} from '@projectx/shared';
import {
  AgentExecutor,
  ContextAssembler,
  InMemoryCheckpointStore,
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
  PostgresPolicyRepository,
  SystemAgentsSeed,
} from '@projectx/control-plane';
import { SpecialistImplementationRegistry } from '@projectx/specialist-agents';
import { PostgresAuditLog } from '@projectx/infrastructure';
import { connectPostgres, runMigrations } from './helpers';

const TENANT_A = 'tenant-a';

class DeterministicReasoningEngine implements IReasoningEngine {
  async reason(_ctx: TenantContext, _request: ReasoningRequest): Promise<ReasoningOutput> {
    return {
      rationale: 'Slice 4 E2E deterministic reasoning',
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

describe('Slice 4 Specialist Agents E2E', () => {
  let pool: Pool | undefined;
  let postgresClient: PostgresClient | undefined;
  let agentExecutor: AgentExecutor | undefined;
  let agentRegistry: ControlPlaneAgentRegistry | undefined;

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

    agentRegistry = new ControlPlaneAgentRegistry({
      agentRepository: agentRepo,
      capabilityRepository: capabilityRepo,
    });
    const policyClient = new ControlPlanePolicyClient({ policyEvaluationService: policyEvaluation });

    const memory = new InMemoryMemoryRetriever();
    const knowledge = new InMemoryKnowledgeRetriever();
    const assembler = new ContextAssembler({ memoryRetriever: memory, knowledgeRetriever: knowledge });

    agentExecutor = new AgentExecutor({
      agentRegistry,
      implementationRegistry: new SpecialistImplementationRegistry(),
      policyClient,
      contextAssembler: assembler,
      memoryRetriever: memory,
      knowledgeRetriever: knowledge,
      reasoningEngine: new DeterministicReasoningEngine(),
      decisionEngine: new PolicyAwareDecisionEngine(),
      toolClient: new ToolExecutor(new NoopToolClient() as any, new NoOpTelemetry(), { maxRetries: 0, baseDelayMs: 10 }),
      outputValidator: new StructuredOutputValidator({
        requiredFields: [],
        forbiddenValues: [],
        allowedActions: [],
        piiPatterns: [],
      }),
      telemetry: new NoOpTelemetry(),
      checkpointStore: new InMemoryCheckpointStore(),
    });

    const ctx: TenantContext = { tenantId: asTenantId(TENANT_A), correlationId: asCorrelationId(randomUUID()), userId: asUserId('tester') };

    // Seed the 11 system specialists through the Control Plane lifecycle.
    const seed = new SystemAgentsSeed({
      agentRepository: agentRepo,
      controlPlane: {
        agentRepository: agentRepo,
        capabilityRepository: capabilityRepo,
        modelRepository: undefined as any,
        policyRepository: policyRepo,
        autonomyRepository: autonomyRepo,
        auditSink,
      },
      lifecycle: { agentRepository: agentRepo, auditSink },
    });
    await seed.seed({ tenantId: asTenantId('system'), correlationId: asCorrelationId(randomUUID()) });
  });

  afterAll(async () => {
    if (postgresClient) await postgresClient.end();
  });

  const cases = [
    {
      agentId: 'research-agent',
      capability: 'research',
      input: { companyName: 'Acme Corp', domain: 'acme.example.com', researchScope: 'company' },
      expected: 'COMPLETED',
    },
    {
      agentId: 'icp-qualification-agent',
      capability: 'icp_qualification',
      input: { company: { industry: 'SaaS', size: '100' }, icpCriteria: { industries: ['SaaS'], minSize: 50 } },
      expected: 'COMPLETED',
    },
    {
      agentId: 'lead-qualification-agent',
      capability: 'lead_qualification',
      input: { lead: { title: 'VP Sales', seniority: 'VP', department: 'Sales' }, idealPersona: { seniorities: ['VP'] } },
      expected: 'COMPLETED',
    },
    {
      agentId: 'buying-signal-agent',
      capability: 'buying_signal_detection',
      input: { signals: [{ type: 'intent', source: 'web', value: 'pricing' }], intentTopics: ['pricing'] },
      expected: 'COMPLETED',
    },
    {
      agentId: 'outreach-strategist-agent',
      capability: 'outreach_strategy',
      input: { objective: 'schedule demo', constraints: { maxSteps: 3, channels: ['email'] } },
      expected: 'COMPLETED',
    },
    {
      agentId: 'outreach-writer-agent',
      capability: 'outreach_writing',
      input: { channel: 'email', recipient: { name: 'Alice', company: 'Acme', role: 'VP' }, keyPoints: ['demo'] },
      expected: 'COMPLETED',
    },
    {
      agentId: 'conversation-agent',
      capability: 'conversation',
      input: { intent: 'reply', lastInboundMessage: 'Thanks, tell me more' },
      expected: 'COMPLETED',
    },
    {
      agentId: 'meeting-agent',
      capability: 'meeting_scheduling',
      input: { attendees: [{ email: 'alice@acme.com', role: 'VP' }], durationMinutes: 30 },
      expected: 'COMPLETED',
    },
    {
      agentId: 'crm-agent',
      capability: 'crm_sync',
      input: { operation: 'contact_update', contact: { email: 'alice@acme.com', company: 'Acme' } },
      expected: 'COMPLETED',
    },
    {
      agentId: 'follow-up-nurture-agent',
      capability: 'follow_up',
      input: { engagementTrend: 'warming', lastTouchDays: 2, sequenceStep: 1 },
      expected: 'COMPLETED',
    },
    {
      agentId: 'compliance-safety-agent',
      capability: 'compliance_review',
      input: { proposedOutput: 'email: alice@acme.com SSN: 123-45-6789', contentType: 'message' },
      expected: 'FAILED',
    },
  ];

  it.each(cases)('selects and invokes $agentId via Control Plane + implementation key', async ({ agentId, capability, input, expected }) => {
    const resolved = await agentRegistry!.getAgent({ tenantId: asTenantId(TENANT_A) } as TenantContext, agentId, '1.0.0');
    expect(resolved).not.toBeNull();
    expect(resolved!.agentId).toBe(agentId);
    expect(resolved!.lifecycle).toBe('ACTIVE');
    expect(resolved!.implementationKey).toMatch(/^specialist\./);

    const request: AIExecutionRequest = {
      executionId: `exec-${agentId}-${randomUUID()}`,
      tenantId: asTenantId(TENANT_A),
      missionId: 'mission-slice4',
      agentId,
      agentVersion: '1.0.0',
      taskId: `task-${agentId}`,
      taskType: capability,
      correlationId: asCorrelationId(randomUUID()),
      context: { target: input },
      capabilities: [capability],
      policyContext: {
        autonomyLevel: 3,
        riskCategory: 'LOW',
        tenantPolicyVersion: 'v1',
        missionPolicyVersion: 'v1',
      },
      budget: { maxTokens: 1000, maxCostUsd: 1, maxDurationSeconds: 60 },
      idempotencyKey: asIdempotencyKey(`idem-${agentId}-${randomUUID()}`),
      metadata: {},
    };

    const result = await agentExecutor!.execute(request);
    expect(result.status).toBe(expected);
    expect(result.tenantId).toBe(asTenantId(TENANT_A));
    expect(result.outcome).toBeDefined();
  });

  it('fails closed when two active agents claim the same capability', async () => {
    // Insert a second active agent with overlapping capability to force ambiguity.
    await postgresClient!.withTenant({ tenantId: asTenantId(TENANT_A), correlationId: asCorrelationId(randomUUID()) } as TenantContext, async (client) => {
      await client.query(
        `INSERT INTO control_plane.agent_versions
          (version_id, agent_id, tenant_id, is_system, version, lifecycle, implementation_key,
           name, role, description, capabilities, tools, policies, model_policy, memory_policy, knowledge_policy,
           autonomy_level_default, evaluation_policy, owner, created_at, updated_at)
         VALUES ($1, $2, current_setting('app.current_tenant', true), false, '1.0.0', 'ACTIVE', 'specialist.research.v1',
                 'Second Research', 'researcher', 'duplicate', ARRAY['research'], '{}', '[]', '{}', '{}', '{}',
                 3, '{}', 'test', NOW(), NOW())
         ON CONFLICT (version_id) DO UPDATE SET lifecycle = EXCLUDED.lifecycle, updated_at = NOW()`,
        [`${TENANT_A}:research-agent-2:1.0.0`, 'research-agent-2'],
      );
    });

    await expect(agentRegistry!.selectActiveAgentForCapability({ tenantId: asTenantId(TENANT_A) } as TenantContext, 'research')).rejects.toThrow(/ambiguous/i);

    await postgresClient!.withTenant({ tenantId: asTenantId(TENANT_A), correlationId: asCorrelationId(randomUUID()) } as TenantContext, async (client) => {
      await client.query(`DELETE FROM control_plane.agent_versions WHERE agent_id = 'research-agent-2'`);
    });
  });
});
