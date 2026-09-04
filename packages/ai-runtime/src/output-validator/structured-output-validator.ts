import type { TenantContext } from '@projectx/domain';
import { ensureSameTenant } from '@projectx/domain';
import type {
  IOutputValidator,
  OutputValidationRequest,
  OutputValidationResult,
  OutputValidatorPolicy,
  SchemaDefinition,
} from './output-validator.interface';

export class StructuredOutputValidator implements IOutputValidator {
  constructor(private readonly defaultPolicy: OutputValidatorPolicy) {}

  async validate(
    ctx: TenantContext,
    request: OutputValidationRequest,
  ): Promise<OutputValidationResult> {
    ensureSameTenant(ctx, request.execution.tenantId);

    const policy = request.policy ?? this.defaultPolicy;
    const output = request.proposedOutput;
    const schemaViolations: string[] = [];
    const policyViolations: string[] = [];

    if (!output || typeof output !== 'object') {
      return {
        valid: false,
        piiCheck: 'PASSED',
        schemaViolations: ['Output must be an object'],
        safeOutput: {},
      };
    }

    if (policy.schema) {
      this.validateSchema(output, policy.schema, '', schemaViolations);
    }

    for (const field of policy.requiredFields) {
      const record = output as Record<string, unknown>;
      if (!(field in record) || record[field] === undefined || record[field] === null) {
        schemaViolations.push(`Missing required field: ${field}`);
      }
    }

    const record = output as Record<string, unknown>;
    for (const forbidden of policy.forbiddenValues) {
      const serialized = JSON.stringify(output);
      if (serialized.includes(forbidden)) {
        policyViolations.push(`Forbidden value detected: ${forbidden}`);
      }
    }

    const action = record.action;
    if (action !== undefined && !policy.allowedActions.includes(String(action))) {
      policyViolations.push(`Unsupported action: ${String(action)}`);
    }

    const text = JSON.stringify(output);
    let piiCheck: 'PASSED' | 'FAILED' = 'PASSED';
    for (const pattern of policy.piiPatterns) {
      if (pattern.test(text)) {
        piiCheck = 'FAILED';
        policyViolations.push('PII detected in output');
        break;
      }
    }

    const safeOutput = this.sanitize(record);

    return {
      valid: schemaViolations.length === 0 && policyViolations.length === 0,
      piiCheck,
      schemaViolations,
      policyViolations,
      safeOutput,
    };
  }

  private validateSchema(value: unknown, schema: SchemaDefinition, path: string, violations: string[]): void {
    if (schema.type === 'object') {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        violations.push(`${path || 'root'} must be an object`);
        return;
      }
      const record = value as Record<string, unknown>;
      for (const field of schema.required ?? []) {
        if (!(field in record) || record[field] === undefined || record[field] === null) {
          violations.push(`${path || 'root'} is missing required field: ${field}`);
        }
      }
      for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
        if (key in record) {
          this.validateSchema(record[key], childSchema, path ? `${path}.${key}` : key, violations);
        }
      }
      return;
    }

    if (schema.type === 'array') {
      if (!Array.isArray(value)) {
        violations.push(`${path || 'root'} must be an array`);
        return;
      }
      if (schema.items) {
        for (let i = 0; i < value.length; i += 1) {
          this.validateSchema(value[i], schema.items, `${path}[${i}]`, violations);
        }
      }
      return;
    }

    if (schema.type === 'string') {
      if (typeof value !== 'string') {
        violations.push(`${path || 'root'} must be a string`);
      } else if (schema.allowedValues && !schema.allowedValues.includes(value)) {
        violations.push(`${path || 'root'} must be one of ${schema.allowedValues.join(', ')}`);
      }
      return;
    }

    if (schema.type === 'number') {
      if (typeof value !== 'number') {
        violations.push(`${path || 'root'} must be a number`);
      }
      return;
    }

    if (schema.type === 'boolean') {
      if (typeof value !== 'boolean') {
        violations.push(`${path || 'root'} must be a boolean`);
      }
      return;
    }
  }

  private sanitize(output: Record<string, unknown>): Record<string, unknown> {
    const clone = { ...output };
    for (const key of Object.keys(clone)) {
      const value = clone[key];
      if (typeof value === 'string') {
        clone[key] = value.replace(/ignore previous instructions/gi, '[FILTERED]');
      }
    }
    return clone;
  }
}
