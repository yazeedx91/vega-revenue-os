import { StructuredOutputValidator } from '@projectx/ai-runtime';
import type { OutputValidationRequest } from '@projectx/ai-runtime';
import { asCorrelationId, asIdempotencyKey, asTenantId } from '@projectx/shared';
import { baseExecution } from './fixtures';

const tenantId = asTenantId('tenant-1');
const otherTenantId = asTenantId('tenant-2');

describe('StructuredOutputValidator', () => {
  const policy = {
    requiredFields: ['conclusion'],
    forbiddenValues: ['malicious'],
    allowedActions: ['search'],
    piiPatterns: [/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/],
  };

  function buildRequest(output: unknown): OutputValidationRequest {
    return {
      execution: baseExecution(),
      proposedOutput: output,
      toolResults: [],
      correlationId: asCorrelationId('corr-1'),
      idempotencyKey: asIdempotencyKey('idem-1'),
    };
  }

  it('validates a conforming output', async () => {
    const validator = new StructuredOutputValidator(policy);
    const request = buildRequest({ conclusion: 'proceed', action: 'search' });

    const result = await validator.validate({ tenantId, correlationId: asCorrelationId('corr-1') }, request);

    expect(result.valid).toBe(true);
    expect(result.piiCheck).toBe('PASSED');
  });

  it('rejects missing required fields', async () => {
    const validator = new StructuredOutputValidator(policy);
    const result = await validator.validate(
      { tenantId, correlationId: asCorrelationId('corr-1') },
      buildRequest({ action: 'search' }),
    );

    expect(result.valid).toBe(false);
    expect(result.schemaViolations).toContain('Missing required field: conclusion');
  });

  it('rejects forbidden values', async () => {
    const validator = new StructuredOutputValidator(policy);
    const result = await validator.validate(
      { tenantId, correlationId: asCorrelationId('corr-1') },
      buildRequest({ conclusion: 'malicious', action: 'search' }),
    );

    expect(result.valid).toBe(false);
    expect(result.policyViolations).toContain('Forbidden value detected: malicious');
  });

  it('rejects unsupported actions', async () => {
    const validator = new StructuredOutputValidator(policy);
    const result = await validator.validate(
      { tenantId, correlationId: asCorrelationId('corr-1') },
      buildRequest({ conclusion: 'proceed', action: 'delete' }),
    );

    expect(result.valid).toBe(false);
    expect(result.policyViolations).toContain('Unsupported action: delete');
  });

  it('detects PII in output', async () => {
    const validator = new StructuredOutputValidator(policy);
    const result = await validator.validate(
      { tenantId, correlationId: asCorrelationId('corr-1') },
      buildRequest({ conclusion: 'proceed', email: 'ceo@example.com' }),
    );

    expect(result.valid).toBe(false);
    expect(result.piiCheck).toBe('FAILED');
  });

  it('rejects cross-tenant validation attempts', async () => {
    const validator = new StructuredOutputValidator(policy);
    const request = buildRequest({ conclusion: 'proceed' });

    await expect(
      validator.validate(
        { tenantId: otherTenantId, correlationId: asCorrelationId('corr-1') },
        request,
      ),
    ).rejects.toThrow();
  });
});
