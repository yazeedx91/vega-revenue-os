import type { TenantContext } from '@projectx/domain';
import { ensureSameTenant } from '@projectx/domain';
import type {
  IOutputValidator,
  OutputValidationRequest,
  OutputValidationResult,
} from './output-validator.interface';

export interface SchemaDefinition {
  readonly type: string;
  readonly required?: string[];
  readonly properties?: Record<string, SchemaDefinition>;
  readonly allowedValues?: unknown[];
}

export interface OutputValidatorPolicy {
  readonly requiredFields: string[];
  readonly forbiddenValues: string[];
  readonly allowedActions: string[];
  readonly piiPatterns: RegExp[];
}

export class StructuredOutputValidator implements IOutputValidator {
  constructor(private readonly policy: OutputValidatorPolicy) {}

  async validate(
    ctx: TenantContext,
    request: OutputValidationRequest,
  ): Promise<OutputValidationResult> {
    ensureSameTenant(ctx, request.execution.tenantId);

    const output = request.proposedOutput as Record<string, unknown> | null;
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

    for (const field of this.policy.requiredFields) {
      if (!(field in output) || output[field] === undefined || output[field] === null) {
        schemaViolations.push(`Missing required field: ${field}`);
      }
    }

    for (const forbidden of this.policy.forbiddenValues) {
      const serialized = JSON.stringify(output);
      if (serialized.includes(forbidden)) {
        policyViolations.push(`Forbidden value detected: ${forbidden}`);
      }
    }

    const action = output.action;
    if (action !== undefined && !this.policy.allowedActions.includes(String(action))) {
      policyViolations.push(`Unsupported action: ${String(action)}`);
    }

    const text = JSON.stringify(output);
    let piiCheck: 'PASSED' | 'FAILED' = 'PASSED';
    for (const pattern of this.policy.piiPatterns) {
      if (pattern.test(text)) {
        piiCheck = 'FAILED';
        policyViolations.push('PII detected in output');
        break;
      }
    }

    const safeOutput = this.sanitize(output);

    return {
      valid: schemaViolations.length === 0 && policyViolations.length === 0,
      piiCheck,
      schemaViolations,
      policyViolations,
      safeOutput,
    };
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
