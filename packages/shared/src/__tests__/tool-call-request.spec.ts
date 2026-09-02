import type { ToolCallRequest } from '../contracts/tool-contract';
import { asTenantId } from '../types/tenant-id';
import { asCorrelationId, asIdempotencyKey } from '../types/correlation';

describe('ToolCallRequest idempotency', () => {
  it('requires an idempotency key for mutating tool calls', () => {
    const request: ToolCallRequest = {
      toolCallId: 'tc-1',
      toolId: 'SendEmail',
      toolVersion: '1.0.0',
      tenantId: asTenantId('tenant-1'),
      missionId: 'mission-1',
      agentId: 'agent-1',
      agentVersion: '1.0.0',
      executionId: 'exec-1',
      taskId: 'task-1',
      correlationId: asCorrelationId('corr-1'),
      idempotencyKey: asIdempotencyKey('idem-1'),
      authorization: {
        policyDecisionId: 'pd-1',
        decision: 'ALLOW',
        capabilities: ['SendEmail'],
        expiresAt: new Date(),
      },
      riskCategory: 'MEDIUM',
      input: {},
      timeoutSeconds: 30,
    };

    expect(request.idempotencyKey).toBe('idem-1');
    expect(request.authorization.decision).toBe('ALLOW');
  });
});
