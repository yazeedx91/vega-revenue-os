import { evaluateAutonomy } from '../domain';

describe('AutonomyLevel', () => {
  it('level 0 always requires approval regardless of risk', () => {
    expect(evaluateAutonomy(0, 'LOW', 0.9, 'ALLOW')).toBe('REQUIRE_APPROVAL');
  });

  it('level 5 + low risk + high confidence => ALLOW when policy allows', () => {
    expect(evaluateAutonomy(5, 'LOW', 0.9, 'ALLOW')).toBe('ALLOW');
  });

  it('high risk at level 3 requires approval', () => {
    expect(evaluateAutonomy(3, 'HIGH', 0.9, 'ALLOW')).toBe('REQUIRE_APPROVAL');
  });

  it('low confidence requires approval', () => {
    expect(evaluateAutonomy(4, 'LOW', 0.4, 'ALLOW')).toBe('REQUIRE_APPROVAL');
  });

  it('cannot expand a DENY policy ceiling', () => {
    expect(evaluateAutonomy(5, 'LOW', 0.9, 'DENY')).toBe('DENY');
  });

  it('cannot expand a REQUIRE_APPROVAL policy ceiling to ALLOW', () => {
    expect(evaluateAutonomy(5, 'LOW', 0.9, 'REQUIRE_APPROVAL')).toBe('REQUIRE_APPROVAL');
  });
});
