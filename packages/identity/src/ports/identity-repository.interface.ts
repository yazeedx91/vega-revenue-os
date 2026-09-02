import type { TenantId } from '@projectx/shared';
import type { User } from '../domain/user';
import type { Workspace } from '../domain/workspace';
import type { Membership } from '../domain/membership';
import type { WorkspaceRole } from '../domain/roles';

export interface UserIdentityLookup {
  id: string;
  email: string;
  name: string | null;
}

export interface WorkspaceMembersResult {
  workspaceId: string;
  members: Array<{ userId: string; email: string; name: string | null; role: WorkspaceRole }>;
}

export interface IdentityRepository {
  /**
   * Upsert a user record by email. Returns the user with an assigned tenant-scoped id.
   */
  upsertUser(lookup: UserIdentityLookup): Promise<User>;
  /**
   * Load a user by email, or return null.
   */
  findUserByEmail(email: string): Promise<User | null>;
  /**
   * Load a user by id, or return null.
   */
  findUserById(userId: string): Promise<User | null>;
  /**
   * Create a workspace owned by the given user.
   */
  createWorkspace(name: string, ownerUserId: string): Promise<Workspace>;
  /**
   * Load a workspace by id and tenant.
   */
  findWorkspaceById(workspaceId: string, tenantId: TenantId): Promise<Workspace | null>;
  /**
   * List all workspaces where the user is a member.
   */
  listWorkspacesForUser(userId: string): Promise<Workspace[]>;
  /**
   * Add a member to a workspace.
   */
  addMember(workspaceId: string, tenantId: TenantId, userId: string, role: WorkspaceRole): Promise<Membership>;
  /**
   * List members of a workspace.
   */
  listMembers(workspaceId: string, tenantId: TenantId): Promise<WorkspaceMembersResult>;
  /**
   * Determine whether a user is a member of a workspace.
   */
  isMember(workspaceId: string, tenantId: TenantId, userId: string): Promise<boolean>;
}
