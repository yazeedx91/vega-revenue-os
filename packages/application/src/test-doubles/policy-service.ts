import type { CommandContext } from '../commands/command-context';
import type { IPolicyService, PolicyAction, PolicyDecision } from '../ports/policy-service';

export class FixedPolicyService implements IPolicyService {
  constructor(private readonly decision: PolicyDecision = 'ALLOW') {}

  async evaluate(_ctx: CommandContext, _action: PolicyAction): Promise<PolicyDecision> {
    return this.decision;
  }
}
