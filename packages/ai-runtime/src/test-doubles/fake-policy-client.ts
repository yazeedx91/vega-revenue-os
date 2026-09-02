import type { TenantContext } from '@projectx/domain';
import type { AIExecutionRequest } from '@projectx/shared';
import type { IPolicyClient, PolicyDecision } from '../policy-client/policy-client.interface';

export class FakePolicyClient implements IPolicyClient {
  constructor(private readonly decision: PolicyDecision) {}

  async evaluate(_ctx: TenantContext, _request: AIExecutionRequest): Promise<PolicyDecision> {
    return this.decision;
  }
}
