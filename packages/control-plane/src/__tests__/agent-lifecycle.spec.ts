import { canTransitionAgentLifecycle } from '../domain';

describe('AgentLifecycle', () => {
  it('allows DRAFT -> TESTING', () => {
    expect(canTransitionAgentLifecycle('DRAFT', 'TESTING')).toBe(true);
  });

  it('denies DRAFT -> ACTIVE', () => {
    expect(canTransitionAgentLifecycle('DRAFT', 'ACTIVE')).toBe(false);
  });

  it('allows APPROVED -> ACTIVE', () => {
    expect(canTransitionAgentLifecycle('APPROVED', 'ACTIVE')).toBe(true);
  });

  it('denies ACTIVE -> TESTING', () => {
    expect(canTransitionAgentLifecycle('ACTIVE', 'TESTING')).toBe(false);
  });

  it('denies RETIRED -> anything', () => {
    expect(canTransitionAgentLifecycle('RETIRED', 'APPROVED')).toBe(false);
  });
});
