import { ToolExecutor } from '@projectx/ai-runtime';
import type { ToolCallRequest, ToolCallResult } from '@projectx/shared';
import { asCorrelationId, asIdempotencyKey, asTenantId } from '@projectx/shared';
import { NoOpTelemetry } from '@projectx/ai-runtime';

const tenantId = asTenantId('tenant-1');

function buildRequest(authorization: ToolCallRequest['authorization']): ToolCallRequest {
  return {
    toolCallId: 'tc-1',
    toolId: 'web_search',
    toolVersion: '1.0.0',
    tenantId,
    missionId: 'm-1',
    agentId: 'agent-1',
    agentVersion: '1.0.0',
    executionId: 'exec-1',
    taskId: 'task-1',
    correlationId: asCorrelationId('corr-1'),
    idempotencyKey: asIdempotencyKey('idem-1'),
    authorization,
    riskCategory: 'MEDIUM',
    input: { query: 'x' },
    timeoutSeconds: 30,
  };
}

function allowAuth(): ToolCallRequest['authorization'] {
  return {
    policyDecisionId: 'pd-1',
    decision: 'ALLOW',
    capabilities: ['research'],
    expiresAt: new Date(Date.now() + 60000),
  };
}

function successResult(): ToolCallResult {
  return {
    toolCallId: 'tc-1',
    status: 'SUCCESS',
    output: {},
    validation: { schemaValid: true, tenantIsolationCheck: true, piiCheck: 'PASSED' },
    provider: 'fake',
    startedAt: new Date(),
    completedAt: new Date(),
    retryCount: 0,
    auditId: 'audit-1',
  };
}

describe('ToolExecutor', () => {
  it('executes an authorized tool call', async () => {
    const gateway = { call: jest.fn().mockResolvedValue(successResult()) };
    const executor = new ToolExecutor(gateway as any, new NoOpTelemetry(), {
      maxRetries: 0,
      baseDelayMs: 10,
    });

    const result = await executor.call(buildRequest(allowAuth()));

    expect(result.status).toBe('SUCCESS');
    expect(gateway.call).toHaveBeenCalledTimes(1);
  });

  it('rejects a tool call that is not allowed', async () => {
    const gateway = { call: jest.fn().mockResolvedValue(successResult()) };
    const executor = new ToolExecutor(gateway as any, new NoOpTelemetry(), {
      maxRetries: 0,
      baseDelayMs: 10,
    });

    await expect(
      executor.call(
        buildRequest({
          policyDecisionId: 'pd-1',
          decision: 'DENY',
          capabilities: [],
          expiresAt: new Date(Date.now() + 60000),
        }),
      ),
    ).rejects.toThrow('not authorized');
    expect(gateway.call).not.toHaveBeenCalled();
  });

  it('rejects an expired authorization', async () => {
    const gateway = { call: jest.fn().mockResolvedValue(successResult()) };
    const executor = new ToolExecutor(gateway as any, new NoOpTelemetry(), {
      maxRetries: 0,
      baseDelayMs: 10,
    });

    await expect(
      executor.call(
        buildRequest({
          policyDecisionId: 'pd-1',
          decision: 'ALLOW',
          capabilities: [],
          expiresAt: new Date(Date.now() - 1000),
        }),
      ),
    ).rejects.toThrow('expired');
  });

  it('retries retryable provider errors up to maxRetries', async () => {
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
    const gateway = { call: jest.fn().mockResolvedValueOnce(retryable).mockResolvedValueOnce(successResult()) };
    const executor = new ToolExecutor(gateway as any, new NoOpTelemetry(), {
      maxRetries: 1,
      baseDelayMs: 10,
    });

    const result = await executor.call(buildRequest(allowAuth()));

    expect(result.status).toBe('SUCCESS');
    expect(gateway.call).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-retryable failures', async () => {
    const failure: ToolCallResult = {
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
    const gateway = { call: jest.fn().mockResolvedValue(failure) };
    const executor = new ToolExecutor(gateway as any, new NoOpTelemetry(), {
      maxRetries: 2,
      baseDelayMs: 10,
    });

    const result = await executor.call(buildRequest(allowAuth()));

    expect(result.status).toBe('VALIDATION_ERROR');
    expect(gateway.call).toHaveBeenCalledTimes(1);
  });
});
