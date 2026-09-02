import type { CapabilityId } from '@projectx/shared';
import { ValueObject } from '../value-object/value-object';

export class Capability extends ValueObject {
  constructor(
    public readonly id: CapabilityId,
    public readonly name: string,
    public readonly description: string,
    public readonly riskCategory: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
    public readonly allowedTools: string[],
    public readonly requiredPolicies: string[],
  ) {
    super();
  }

  protected getEqualityComponents(): unknown[] {
    return [this.id, this.name, this.description, this.riskCategory, this.allowedTools, this.requiredPolicies];
  }
}
