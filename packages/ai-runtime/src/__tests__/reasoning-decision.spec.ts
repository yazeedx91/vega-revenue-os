import {
  LLMBasedReasoningEngine,
  LLMRouter,
  PolicyAwareDecisionEngine,
  FakeLLMProvider,
  NoOpTelemetry,
} from '@projectx/ai-runtime';
import { asCorrelationId, asIdempotencyKey, asTenantId } from '@projectx/shared';
import { baseExecution, tenantId } from './fixtures';

const otherTenantId = asTenantId('tenant-2');

describe('LLMBasedReasoningEngine', () => {
  it('parses structured JSON reasoning output', async () => {
    const provider = new FakeLLMProvider('fake', ['fake'], () => ({
      content: JSON.stringify({
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
      }),
      model: 'fake',
      provider: 'fake',
      tokensInput: 5,
      tokensOutput: 15,
      costUsd: 0.01,
    }));
    const llm = new LLMRouter(
      [provider],
      new NoOpTelemetry(),
      { defaultModelFamily: 'fake', defaultMaxTokens: 100, defaultTimeoutMs: 5000 },
    );
    const engine = new LLMBasedReasoningEngine(llm);

    const result = await engine.reason(
      { tenantId, correlationId: asCorrelationId('corr-1') },
      {
        execution: baseExecution(),
        promptContext: {
          systemPromptVersion: '1',
          userMessage: 'Task: research',
          toolsAvailable: ['web_search'],
        },
        observations: [],
        correlationId: asCorrelationId('corr-1'),
      },
    );

    expect(result.conclusion).toBe('proceed');
    expect(result.confidence).toBe(0.85);
    expect(result.proposedActions).toHaveLength(1);
    expect(result.modelUsage).toBeDefined();
  });

  it('falls back to free text when JSON is invalid', async () => {
    const provider = new FakeLLMProvider('fake', ['fake'], () => ({
      content: 'I think we should proceed.',
      model: 'fake',
      provider: 'fake',
      tokensInput: 5,
      tokensOutput: 5,
      costUsd: 0.001,
    }));
    const llm = new LLMRouter(
      [provider],
      new NoOpTelemetry(),
      { defaultModelFamily: 'fake', defaultMaxTokens: 100, defaultTimeoutMs: 5000 },
    );
    const engine = new LLMBasedReasoningEngine(llm);

    const result = await engine.reason(
      { tenantId, correlationId: asCorrelationId('corr-1') },
      {
        execution: baseExecution(),
        promptContext: {
          systemPromptVersion: '1',
          userMessage: 'Task: research',
          toolsAvailable: ['web_search'],
        },
        observations: [],
        correlationId: asCorrelationId('corr-1'),
      },
    );

    expect(result.conclusion).toBe('parsed_from_free_text');
    expect(result.confidence).toBe(0.5);
  });

  it('rejects cross-tenant reasoning requests', async () => {
    const provider = new FakeLLMProvider('fake', ['fake'], () => ({
      content: '{}',
      model: 'fake',
      provider: 'fake',
      tokensInput: 0,
      tokensOutput: 0,
      costUsd: 0,
    }));
    const llm = new LLMRouter(
      [provider],
      new NoOpTelemetry(),
      { defaultModelFamily: 'fake', defaultMaxTokens: 100, defaultTimeoutMs: 5000 },
    );
    const engine = new LLMBasedReasoningEngine(llm);

    await expect(
      engine.reason(
        { tenantId: otherTenantId, correlationId: asCorrelationId('corr-1') },
        {
          execution: baseExecution(),
          promptContext: {
            systemPromptVersion: '1',
            userMessage: 'Task: research',
            toolsAvailable: ['web_search'],
          },
          observations: [],
          correlationId: asCorrelationId('corr-1'),
        },
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
