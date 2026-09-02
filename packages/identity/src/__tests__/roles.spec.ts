import { permissionsForRole, WORKSPACE_ROLES } from '../domain/roles';

describe('Workspace roles', () => {
  it('returns permissions for each role', () => {
    expect(permissionsForRole(WORKSPACE_ROLES.OWNER)).toContain('workspace:manage');
    expect(permissionsForRole(WORKSPACE_ROLES.MEMBER)).toContain('workspace:read');
    expect(permissionsForRole(WORKSPACE_ROLES.OPERATOR)).toContain('mission:pause');
  });

  it('returns an empty array for an unknown role', () => {
    expect(permissionsForRole('UNKNOWN' as any)).toEqual([]);
  });
});
