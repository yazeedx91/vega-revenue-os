import type {
  IToolSchemaValidator,
  ToolSchemaDefinition,
  ToolSchemaValidationResult,
} from '../contracts/tool-contract';

/**
 * Strict, dependency-free JSON-schema validator for tool input/output.
 * Lives in `shared` so the governed tool gateway validates schemas without
 * coupling to the LLM-specific output validator (keeps dependency direction
 * correct: tool-gateway → shared, not tool-gateway → ai-runtime).
 */
export class StrictToolSchemaValidator implements IToolSchemaValidator {
  validate(value: unknown, schema: ToolSchemaDefinition): ToolSchemaValidationResult {
    const violations: string[] = [];
    this.validateNode(value, schema, '$', violations);
    return { valid: violations.length === 0, violations };
  }

  private validateNode(
    value: unknown,
    schema: ToolSchemaDefinition,
    path: string,
    violations: string[],
  ): void {
    switch (schema.type) {
      case 'object':
        this.validateObject(value, schema, path, violations);
        return;
      case 'array':
        this.validateArray(value, schema, path, violations);
        return;
      case 'string':
        if (typeof value !== 'string') violations.push(`${path}: expected string`);
        break;
      case 'number':
        if (typeof value !== 'number' || Number.isNaN(value)) violations.push(`${path}: expected number`);
        break;
      case 'boolean':
        if (typeof value !== 'boolean') violations.push(`${path}: expected boolean`);
        break;
      default:
        violations.push(`${path}: unknown schema type`);
    }

    if (schema.allowedValues && violations.length === 0) {
      const allowed = schema.allowedValues.some((v) => this.deepEqual(v, value));
      if (!allowed) violations.push(`${path}: value not in allowedValues`);
    }
  }

  private validateObject(
    value: unknown,
    schema: ToolSchemaDefinition,
    path: string,
    violations: string[],
  ): void {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      violations.push(`${path}: expected object`);
      return;
    }
    const obj = value as Record<string, unknown>;
    for (const req of schema.required ?? []) {
      if (!(req in obj)) violations.push(`${path}.${req}: required field missing`);
    }
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in obj) {
          this.validateNode(obj[key], propSchema, `${path}.${key}`, violations);
        }
      }
    }
  }

  private validateArray(
    value: unknown,
    schema: ToolSchemaDefinition,
    path: string,
    violations: string[],
  ): void {
    if (!Array.isArray(value)) {
      violations.push(`${path}: expected array`);
      return;
    }
    if (schema.items) {
      value.forEach((item, i) => this.validateNode(item, schema.items as ToolSchemaDefinition, `${path}[${i}]`, violations));
    }
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((k) =>
      this.deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
}
