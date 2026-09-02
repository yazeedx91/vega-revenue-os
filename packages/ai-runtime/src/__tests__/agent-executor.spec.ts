import {
  asTenantId,
  asCorrelationId,
  asIdempotencyKey,
} from '@projectx/shared';
import type { ToolCallRequest, ToolCallResult } from '@projectx/shared';
import {
  AgentExecutor,
  ContextAssembler,
  InMemoryCheckpointStore,
  InMemoryKnowledgeRetriever,
  InMemoryMemoryRetriever,
  LLMBasedReasoningEngine,
  LLMRouter,
  PolicyAwareDecisionEngine,
  StructuredOutputValidator,
  ToolExecutor,
  FakeAgentRegistry,
  FakeLLMProvider,
  FakePolicyClient,
  FakeToolGateway,
  NoOpTelemetry,
} from '@projectx/ai-runtime';
import type { OutputValidatorPolicy } from '@projectx/ai-runtime';
import { baseExecution, activeAgent, tenantId, otherTenantId } from './fixtures';

function future(): Date {
  return new Date(Date.now() + 60000);
}

function reasoningResponse(
  proposedActions: unknown[],
  conclusion = 'proceed',
): {
  content: string;
  model: string;
  provider: string;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
} {
  return {
    content: JSON.stringify({
      rationale: 'Target looks qualified based on public data.',
      conclusion,
      confidence: 0.9,
      evidence: ['company size matches ICP'],
      proposedActions,
      modelUsage: { model: 'fake', provider: 'fake', inputTokens: 10, outputTokens: 20, costUsd: 0.01 },
    }),
    model: 'fake',
    provider: 'fake',
    tokensInput: 10,
    tokensOutput: 20,
    costUsd: 0.01,
  };
}

function successToolResult(): ToolCallResult {
  return {
    toolCallId: 'tc-1',
    status: 'SUCCESS',
    output: { result: 'found 3 leads' },
    validation: { schemaValid: true, tenantIsolationCheck: true, piiCheck: 'PASSED' },
    provider: 'fake',
    startedAt: new Date(),
    completedAt: new Date(),
    retryCount: 0,
    auditId: 'audit-1',
  };
}

function makeExecutor(options: {
  agent?: ReturnType<typeof activeAgent>;
  policyOutcome?: 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';
  toolResults?: ToolCallResult[];
  validatorPolicy?: OutputValidatorPolicy;
  maxToolRetries?: number;
  llmResponse?: ReturnType<typeof reasoningResponse>;
} = {}) {
  const registry = new FakeAgentRegistry();
  registry.register(tenantId, options.agent ?? activeAgent());

  const memory = new InMemoryMemoryRetriever();
  memory.seed({
    memoryId: 'm-1',
    tenantId: tenantId as unknown as string,
    agentId: 'agent-1',
    type: 'working',
    content: 'Prior outreach to this domain was paused.',
    relevance: 0.9,
    authorized: true,
  });

  const knowledge = new InMemoryKnowledgeRetriever();
  knowledge.seed({
    knowledgeId: 'k-1',
    tenantId: tenantId as unknown as string,
    domain: 'global',
    content: 'ICP definition v1: 50-200 employees.',
    relevance: 0.9,
    authorized: true,
  });

  const assembler = new ContextAssembler({ memoryRetriever: memory, knowledgeRetriever: knowledge });

  const policyDecision = {
    decisionId: 'pd-1',
    outcome: options.policyOutcome ?? 'ALLOW',
    capabilities: ['research'],
    expiresAt: future(),
  };
  const policyClient = new FakePolicyClient(policyDecision);

  const actions = [
    {
      actionId: 'a-1',
      capability: 'research',
      toolId: 'web_search',
      toolVersion: '1.0.0',
      input: { query: 'ProjectX competitors' },
      rationale: 'Find competitor list',
      riskCategory: 'MEDIUM' as const,
    },
  ];
  const llm = new LLMRouter(
    [new FakeLLMProvider('fake', ['fake'], () => options.llmResponse ?? reasoningResponse(actions))],
    new NoOpTelemetry(),
    { defaultModelFamily: 'fake', defaultMaxTokens: 100, defaultTimeoutMs: 5000 },
  );
  const reasoningEngine = new LLMBasedReasoningEngine(llm);
  const decisionEngine = new PolicyAwareDecisionEngine();

  const results = options.toolResults ?? [successToolResult()];
  let callCount = 0;
  const gateway = new FakeToolGateway(() => {
    const result = results[callCount % results.length];
    callCount += 1;
    return result;
  });
  const toolExecutor = new ToolExecutor(gateway, new NoOpTelemetry(), {
    maxRetries: options.maxToolRetries ?? 0,
    baseDelayMs: 10,
  });

  const validatorPolicy: OutputValidatorPolicy = options.validatorPolicy ?? {
    requiredFields: [],
    forbiddenValues: [],
    allowedActions: ['search'],
    piiPatterns: [],
  };
  const outputValidator = new StructuredOutputValidator(validatorPolicy);

  const checkpointStore = new InMemoryCheckpointStore();

  const executor = new AgentExecutor({
    agentRegistry: registry,
    policyClient,
    contextAssembler: assembler,
    memoryRetriever: memory,
    knowledgeRetriever: knowledge,
    reasoningEngine,
    decisionEngine,
    toolClient: toolExecutor,
    outputValidator,
    telemetry: new NoOpTelemetry(),
    checkpointStore,
  });

  return { executor, checkpointStore };
}

describe('AgentExecutor', () => {
  it('completes an approved execution with tool results and checkpoints', async () => {
    const { executor, checkpointStore } = makeExecutor();

    const request = baseExecution();
    const result = await executor.execute(request);

    expect(result.status).toBe('COMPLETED');
    expect(result.tenantId).toBe(tenantId);
    expect(result.outcome.actions).toHaveLength(1);
    expect(result.outcome.actions[0]).toMatchObject({ status: 'SUCCESS' });
    expect(result.correlationId).toBe(request.correlationId);

    const checkpoint = await checkpointStore.load(request.executionId);
    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.status).toBe('COMPLETED');
    expect(checkpoint!.toolExecutionHistory).toHaveLength(1);
  });

  it('fails fast when policy denies execution', async () => {
    const { executor } = makeExecutor({ policyOutcome: 'DENY' });

    const result = await executor.execute(baseExecution());

    expect(result.status).toBe('FAILED');
    expect(result.outcome.summary).toContain('Policy denied');
  });

  it('awaits approval when autonomy level is too low for high-risk work', async () => {
    const { executor } = makeExecutor({
      agent: activeAgent({ capabilities: ['research'], tools: ['web_search'] }),
    });

    const request = baseExecution({
      policyContext: {
        autonomyLevel: 1,
        riskCategory: 'HIGH',
        tenantPolicyVersion: 'v1',
        missionPolicyVersion: 'v1',
      },
    });
    const result = await executor.execute(request);

    expect(result.status).toBe('AWAITING_APPROVAL');
  });

  it('fails when the agent is not active', async () => {
    const { executor } = makeExecutor({
      agent: activeAgent({ lifecycle: 'RETIRED' }),
    });

    const result = await executor.execute(baseExecution());

    expect(result.status).toBe('FAILED');
    expect(result.outcome.summary).toContain('not active');
  });

  it('fails when request capabilities exceed agent capabilities', async () => {
    const { executor } = makeExecutor({
      agent: activeAgent({ capabilities: ['write_email'] }),
    });

    const result = await executor.execute(baseExecution({ capabilities: ['research'] }));

    expect(result.status).toBe('FAILED');
    expect(result.outcome.summary).toContain('Missing capabilities');
  });

  it('enforces tenant isolation', async () => {
    const { executor } = makeExecutor();

    const request = baseExecution({ tenantId: otherTenantId, agentId: 'agent-1' });
    const result = await executor.execute(request);

    expect(result.status).toBe('FAILED');
    expect(result.outcome.summary).toContain('not found');
  });

  it('stops when budget is exhausted', async () => {
    const { executor } = makeExecutor();

    const request = baseExecution({
      budget: { maxTokens: 1000, maxCostUsd: 0, maxDurationSeconds: 60 },
    });
    const result = await executor.execute(request);

    expect(result.status).toBe('FAILED');
    expect(result.outcome.summary).toContain('budget');
  });

  it('fails when deadline has already passed', async () => {
    const { executor } = makeExecutor();

    const request = baseExecution({ deadline: new Date(Date.now() - 1000) });
    const result = await executor.execute(request);

    expect(result.status).toBe('FAILED');
    expect(result.outcome.summary).toContain('deadline');
  });

  it('classifies non-retryable tool failures', async () => {
    const toolResult: ToolCallResult = {
      toolCallId: 'tc-1',
      status: 'VALIDATION_ERROR',
      error: { code: 'VALIDATION_ERROR', message: 'bad input', retryable: false },
      validation: { schemaValid: false, tenantIsolationCheck: true, piiCheck: 'PASSED' },
      provider: 'fake',
      startedAt: new Date(),
      completedAt: new Date(),
      retryCount: 0,
      auditId: 'audit-1',
    };
    const { executor } = makeExecutor({ toolResults: [toolResult] });

    const result = await executor.execute(baseExecution());

    expect(result.status).toBe('FAILED');
    expect(result.outcome.summary).toContain('bad input');
  });

  it('retries retryable tool failures and succeeds', async () => {
    const retryable: ToolCallResult = {
      toolCallId: 'tc-1',
      status: 'PROVIDER_ERROR',
      error: { code: 'PROVIDER_ERROR', message: 'transient', retryable: true },
      validation: { schemaValid: true, tenantIsolationCheck: true, piiCheck: 'PASSED' },
      provider: 'fake',
      startedAt: new Date(),
      completedAt: new Date(),
      retryCount: 0,
      auditId: 'audit-1',
    };
    const { executor } = makeExecutor({ toolResults: [retryable, successToolResult()], maxToolRetries: 1 });

    const result = await executor.execute(baseExecution());

    expect(result.status).toBe('COMPLETED');
  });

  it('rejects outputs that violate policy', async () => {
    const { executor } = makeExecutor({
      validatorPolicy: {
        requiredFields: [],
        forbiddenValues: ['badword'],
        allowedActions: ['search'],
        piiPatterns: [],
      },
      llmResponse: reasoningResponse([
        {
          actionId: 'a-1',
          capability: 'research',
          toolId: 'web_search',
          toolVersion: '1.0.0',
          input: { query: 'badword' },
          rationale: 'Search',
          riskCategory: 'MEDIUM',
        },
      ], 'badword'),
    });

    const result = await executor.execute(baseExecution());

    expect(result.status).toBe('FAILED');
    expect(result.outcome.summary).toContain('Output validation failed');
  });

  it('does not retry a policy denial', async () => {
    const { executor } = makeExecutor({ policyOutcome: 'DENY' });

    const result = await executor.execute(baseExecution());

    expect(result.status).toBe('FAILED');
    expect(result.outcome.decisions).toEqual([{ policyDecisionId: 'pd-1', outcome: 'DENY' }]);
  });
});
