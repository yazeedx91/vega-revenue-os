import { Capability } from '../agent/capability';
import { asCapabilityId } from '@projectx/shared';

describe('Capability value object', () => {
  it('compares capabilities by value', () => {
    const id = asCapabilityId('ResearchCompany');
    const a = new Capability(id, 'Research Company', 'Research', 'LOW', ['SearchWeb'], ['SourcePolicy']);
    const b = new Capability(id, 'Research Company', 'Research', 'LOW', ['SearchWeb'], ['SourcePolicy']);
    const c = new Capability(id, 'Research Company', 'Research', 'MEDIUM', ['SearchWeb'], ['SourcePolicy']);

    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });
});
