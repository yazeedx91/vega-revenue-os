import { mergePolicyOutcomes, type PolicyRule } from '../domain';

describe('PolicyPrecedence', () => {
  it('system DENY + action ALLOW => DENY', () => {
    const rules: Pick<PolicyRule, 'scope' | 'outcome'>[] = [
      { scope: 'system', outcome: 'DENY' },
      { scope: 'action', outcome: 'ALLOW' },
    ];
    expect(mergePolicyOutcomes(rules)).toBe('DENY');
  });

  it('system REQUIRE_APPROVAL + action ALLOW => REQUIRE_APPROVAL', () => {
    const rules: Pick<PolicyRule, 'scope' | 'outcome'>[] = [
      { scope: 'system', outcome: 'REQUIRE_APPROVAL' },
      { scope: 'action', outcome: 'ALLOW' },
    ];
    expect(mergePolicyOutcomes(rules)).toBe('REQUIRE_APPROVAL');
  });

  it('tenant REQUIRE_APPROVAL + agent ALLOW => REQUIRE_APPROVAL', () => {
    const rules: Pick<PolicyRule, 'scope' | 'outcome'>[] = [
      { scope: 'tenant', outcome: 'REQUIRE_APPROVAL' },
      { scope: 'agent', outcome: 'ALLOW' },
    ];
    expect(mergePolicyOutcomes(rules)).toBe('REQUIRE_APPROVAL');
  });

  it('tenant ALLOW + mission DENY => DENY', () => {
    const rules: Pick<PolicyRule, 'scope' | 'outcome'>[] = [
      { scope: 'tenant', outcome: 'ALLOW' },
      { scope: 'mission', outcome: 'DENY' },
    ];
    expect(mergePolicyOutcomes(rules)).toBe('DENY');
  });

  it('mission ALLOW + action REQUIRE_APPROVAL => REQUIRE_APPROVAL', () => {
    const rules: Pick<PolicyRule, 'scope' | 'outcome'>[] = [
      { scope: 'mission', outcome: 'ALLOW' },
      { scope: 'action', outcome: 'REQUIRE_APPROVAL' },
    ];
    expect(mergePolicyOutcomes(rules)).toBe('REQUIRE_APPROVAL');
  });

  it('lower scope cannot loosen higher scope REQUIRE_APPROVAL', () => {
    const rules: Pick<PolicyRule, 'scope' | 'outcome'>[] = [
      { scope: 'system', outcome: 'REQUIRE_APPROVAL' },
      { scope: 'tenant', outcome: 'ALLOW' },
      { scope: 'agent', outcome: 'ALLOW' },
    ];
    expect(mergePolicyOutcomes(rules)).toBe('REQUIRE_APPROVAL');
  });
});
