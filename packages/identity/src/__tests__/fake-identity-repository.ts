import { asTenantId, type TenantId } from '@projectx/shared';
import type { IdentityRepository, UserIdentityLookup, WorkspaceMembersResult } from '../ports/identity-repository.interface';
import type { User } from '../domain/user';
import type { Workspace } from '../domain/workspace';
import type { Membership } from '../domain/membership';
import type { WorkspaceRole } from '../domain/roles';

export class FakeIdentityRepository implements IdentityRepository {
  private users = new Map<string, User>();
  private emails = new Map<string, string>();
  private workspaces = new Map<string, Workspace>();
  private memberships = new Map<string, Membership>();

  async upsertUser(lookup: UserIdentityLookup): Promise<User> {
    const existing = this.emails.get(lookup.email);
    if (existing) {
      const user = this.users.get(existing)!;
      user.name = lookup.name;
      return user;
    }
    const user: User = {
      id: lookup.id,
      email: lookup.email,
      name: lookup.name,
      tenantId: asTenantId(lookup.id),
      createdAt: new Date(),
    };
    this.users.set(lookup.id, user);
    this.emails.set(lookup.email, lookup.id);
    return user;
  }

  async findUserByEmail(email: string): Promise<User | null> {
    const id = this.emails.get(email);
    if (!id) return null;
    return this.users.get(id) ?? null;
  }

  async findUserById(userId: string): Promise<User | null> {
    return this.users.get(userId) ?? null;
  }

  async createWorkspace(name: string, ownerUserId: string): Promise<Workspace> {
    const id = `ws-${this.workspaces.size + 1}`;
    const tenantId = asTenantId(ownerUserId);
    const workspace: Workspace = { id, name, tenantId, ownerUserId, createdAt: new Date() };
    this.workspaces.set(id, workspace);
    this.memberships.set(`${id}::${ownerUserId}`, { workspaceId: id, userId: ownerUserId, role: 'OWNER' as WorkspaceRole, createdAt: new Date() });
    return workspace;
  }

  async findWorkspaceById(workspaceId: string, tenantId: TenantId): Promise<Workspace | null> {
    const w = this.workspaces.get(workspaceId);
    if (!w || w.tenantId !== tenantId) return null;
    return w;
  }

  async listWorkspacesForUser(userId: string): Promise<Workspace[]> {
    const memberKeys = [...this.memberships.keys()].filter((k) => k.endsWith(`::${userId}`));
    return memberKeys.map((k) => this.workspaces.get(k.split('::')[0])!).filter((w): w is Workspace => !!w);
  }

  async addMember(workspaceId: string, tenantId: TenantId, userId: string, role: WorkspaceRole): Promise<Membership> {
    const w = this.workspaces.get(workspaceId);
    if (!w || w.tenantId !== tenantId) throw new Error('workspace not found');
    const membership: Membership = { workspaceId, userId, role, createdAt: new Date() };
    this.memberships.set(`${workspaceId}::${userId}`, membership);
    return membership;
  }

  async listMembers(workspaceId: string, tenantId: TenantId): Promise<WorkspaceMembersResult> {
    const w = this.workspaces.get(workspaceId);
    if (!w || w.tenantId !== tenantId) return { workspaceId, members: [] };
    const members = [...this.memberships.values()].filter((m) => m.workspaceId === workspaceId);
    return {
      workspaceId,
      members: members.map((m) => {
        const u = this.users.get(m.userId);
        return { userId: m.userId, email: u?.email ?? m.userId, name: u?.name ?? null, role: m.role };
      }),
    };
  }

  async isMember(workspaceId: string, tenantId: TenantId, userId: string): Promise<boolean> {
    const w = this.workspaces.get(workspaceId);
    if (!w || w.tenantId !== tenantId) return false;
    return this.memberships.has(`${workspaceId}::${userId}`);
  }
}
