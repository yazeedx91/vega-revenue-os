import * as path from 'path';
import { validateWorkspaceIntegrity } from '../workspace-integrity';

describe('workspace dependency/packaging integrity', () => {
  it('has no undeclared @projectx/* dependencies and every depended-on workspace package declares a dist entrypoint', () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const violations = validateWorkspaceIntegrity(repoRoot);

    const report = violations.map((v) => `[${v.rule}] ${v.detail}`).join('\n');
    expect(report).toBe('');
  });
});
