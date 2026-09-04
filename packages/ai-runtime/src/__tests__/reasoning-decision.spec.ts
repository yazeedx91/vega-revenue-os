import {
  InMemoryReasoningArtifactRepository,
  PolicyAwareDecisionEngine,
  ProductionReasoningEngine,
} from '@projectx/ai-runtime';
import { asCorrelationId, asTenantId } from '@projectx/shared';
import { baseExecution, tenantId } from './fixtures';

const otherTenantId = asTenantId('tenant-2');

const reasoningRequest = () => ({
  execution: baseExecution(),
  promptContext: {
    systemPromptVersion: '1',
    userMessage: 'Task: research',
    toolsAvailable: ['web_search'],
  },
  observations: [],
  correlationId: asCorrelationId('corr-1'),
});

const providerResult = (overrides: Record<string, unknown> = {}) => ({
  providerId: 'fake',
  modelId: 'fake',
  providerRequestId: 'req-1',
  content: '',
  structured: {
    rationale: 'Public data supports qualification.',
    conclusion: 'proceed',
    confidence: 0.85,
    evidence: ['size match'],
    proposedActions: [
      {
        actionId: 'a-1',
        capability: 'research',
        toolId: 'web_search',
        toolVersion: '1.0.0',
        input: { query: 'x' },
        rationale: 'Search',
        riskCategory: 'MEDIUM',
      },
    ],
  },
  inputTokens: 5,
  outputTokens: 15,
  totalTokens: 20,
  costUsd: 0.01,
  latencyMs: 10,
  finishReason: 'stop',
  startedAt: new Date(),
  completedAt: new Date(),
  ...overrides,
});

const makeEngine = (result: unknown) =>
  new ProductionReasoningEngine({
    llmRouter: { invoke: async () => result } as any,
    artifactRepository: new InMemoryReasoningArtifactRepository(),
  });

describe('ProductionReasoningEngine', () => {
  it('parses structured JSON reasoning output', async () => {
    const engine = makeEngine(providerResult());

    const result = await engine.reason(
      { tenantId, correlationId: asCorrelationId('corr-1') },
      reasoningRequest(),
    );

    expect(result.conclusion).toBe('proceed');
    expect(result.confidence).toBe(0.85);
    expect(result.proposedActions).toHaveLength(1);
    expect(result.modelUsage).toBeDefined();
  });

  it('returns invalid_structured_output when model output is not valid JSON', async () => {
    const engine = makeEngine(
      providerResult({ structured: undefined, content: 'I think we should proceed.' }),
    );

    const result = await engine.reason(
      { tenantId, correlationId: asCorrelationId('corr-1') },
      reasoningRequest(),
    );

    expect(result.conclusion).toBe('invalid_structured_output');
    expect(result.confidence).toBe(0);
  });

  it('rejects cross-tenant reasoning requests', async () => {
    const engine = makeEngine(providerResult());

    await expect(
      engine.reason(
        { tenantId: otherTenantId, correlationId: asCorrelationId('corr-1') },
        reasoningRequest(),
      ),
    ).rejects.toThrow();
  });
});

describe('PolicyAwareDecisionEngine', () => {
  const baseDecisionInput = {
    execution: baseExecution(),
    reasoning: {
      rationale: '',
      conclusion: 'proceed',
      confidence: 0.9,
      evidence: [],
    },
    policyDecision: {
      decisionId: 'pd-1',
      outcome: 'ALLOW' as const,
      capabilities: ['research'],
      expiresAt: new Date(Date.now() + 60000),
    },
    correlationId: asCorrelationId('corr-1'),
  };

  it('allows execution when policy allows and confidence is high', async () => {
    const engine = new PolicyAwareDecisionEngine();
    const result = await engine.decide(
      { tenantId, correlationId: asCorrelationId('corr-1') },
      baseDecisionInput,
    );
    expect(result.outcome).toBe('ALLOW');
  });

  it('denies when policy denies', async () => {
    const engine = new PolicyAwareDecisionEngine();
    const result = await engine.decide(
      { tenantId, correlationId: asCorrelationId('corr-1') },
      {
        ...baseDecisionInput,
        policyDecision: {
          ...baseDecisionInput.policyDecision,
          outcome: 'DENY',
        },
      },
    );
    expect(result.outcome).toBe('DENY');
  });

  it('requires approval for low confidence', async () => {
    const engine = new PolicyAwareDecisionEngine();
    const result = await engine.decide(
      { tenantId, correlationId: asCorrelationId('corr-1') },
      {
        ...baseDecisionInput,
        reasoning: { ...baseDecisionInput.reasoning, confidence: 0.3 },
      },
    );
    expect(result.outcome).toBe('REQUIRE_APPROVAL');
  });

  it('requires approval for high risk with low autonomy', async () => {
    const engine = new PolicyAwareDecisionEngine();
    const result = await engine.decide(
      { tenantId, correlationId: asCorrelationId('corr-1') },
      {
        ...baseDecisionInput,
        execution: baseExecution({
          policyContext: {
            autonomyLevel: 2,
            riskCategory: 'CRITICAL',
            tenantPolicyVersion: 'v1',
            missionPolicyVersion: 'v1',
          },
        }),
      },
    );
    expect(result.outcome).toBe('REQUIRE_APPROVAL');
  });
});
