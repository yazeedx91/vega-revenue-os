import { ExecutionState, InMemoryCheckpointStore } from '@projectx/ai-runtime';
import { asTenantId } from '@projectx/shared';

const tenantId = asTenantId('tenant-1');

describe('ExecutionState', () => {
  it('tracks budget consumption and tool history', () => {
    const state = new ExecutionState(
      'exec-1',
      tenantId,
      'mission-1',
      'task-1',
      'agent-1',
      { maxTokens: 100, maxCostUsd: 1, maxDurationSeconds: 60 },
    );

    state.transition('RUNNING');
    state.consumeBudget(20, 0.1, 5);
    state.recordToolResult({
      toolCallId: 'tc-1',
      status: 'SUCCESS',
      provider: 'fake',
      startedAt: new Date(),
      completedAt: new Date(),
      retryCount: 0,
      auditId: 'a-1',
    });

    expect(state.isWithinBudget({ maxTokens: 100, maxCostUsd: 1, maxDurationSeconds: 60 })).toBe(true);
    expect(state.toolExecutionHistory).toHaveLength(1);
    expect(state.status).toBe('RUNNING');
  });

  it('detects budget exhaustion', () => {
    const state = new ExecutionState(
      'exec-1',
      tenantId,
      'mission-1',
      'task-1',
      'agent-1',
      { maxTokens: 100, maxCostUsd: 1, maxDurationSeconds: 60 },
    );
    state.consumeBudget(150, 0.5, 5);

    expect(state.isWithinBudget({ maxTokens: 100, maxCostUsd: 1, maxDurationSeconds: 60 })).toBe(false);
  });

  it('classifies retryable failures', () => {
    const state = new ExecutionState(
      'exec-1',
      tenantId,
      'mission-1',
      'task-1',
      'agent-1',
      { maxTokens: 100, maxCostUsd: 1, maxDurationSeconds: 60 },
    );
    state.markFailure({
      code: 'TIMEOUT',
      message: 'timeout',
      retryable: true,
      classification: 'TIMEOUT',
    });

    expect(state.status).toBe('FAILED');
    expect(state.failure?.retryable).toBe(true);
  });
});

describe('InMemoryCheckpointStore', () => {
  it('saves and loads execution state snapshots', async () => {
    const store = new InMemoryCheckpointStore();
    const state = new ExecutionState(
      'exec-1',
      tenantId,
      'mission-1',
      'task-1',
      'agent-1',
      { maxTokens: 100, maxCostUsd: 1, maxDurationSeconds: 60 },
    );
    state.transition('RUNNING');

    await store.save(state.snapshot());
    const loaded = await store.load('exec-1');

    expect(loaded).not.toBeNull();
    expect(loaded!.status).toBe('RUNNING');
    expect(loaded!.executionId).toBe('exec-1');
  });
});
