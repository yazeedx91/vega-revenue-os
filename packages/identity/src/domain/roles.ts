export const WORKSPACE_ROLES = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MEMBER: 'MEMBER',
  OPERATOR: 'OPERATOR',
} as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[keyof typeof WORKSPACE_ROLES];

export const ROLE_PERMISSIONS: Record<WorkspaceRole, string[]> = {
  OWNER: ['workspace:manage', 'member:invite', 'member:remove', 'mission:all', 'approval:all', 'settings:all'],
  ADMIN: ['workspace:read', 'member:invite', 'member:remove', 'mission:all', 'approval:all', 'settings:read'],
  MEMBER: ['workspace:read', 'mission:read', 'mission:execute', 'approval:respond'],
  OPERATOR: ['workspace:read', 'mission:read', 'mission:execute', 'mission:pause', 'mission:resume', 'mission:cancel'],
};

export function permissionsForRole(role: WorkspaceRole): string[] {
  return ROLE_PERMISSIONS[role] ?? [];
}
