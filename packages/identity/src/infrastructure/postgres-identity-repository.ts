import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { asTenantId, type TenantId } from '@projectx/shared';
import type {
  IdentityRepository,
  UserIdentityLookup,
  WorkspaceMembersResult,
} from '../ports/identity-repository.interface';
import type { User } from '../domain/user';
import type { Workspace } from '../domain/workspace';
import type { Membership } from '../domain/membership';
import type { WorkspaceRole } from '../domain/roles';

export interface PostgresIdentityRepositoryConfig {
  pool: Pool;
}

export class PostgresIdentityRepository implements IdentityRepository {
  private readonly pool: Pool;

  constructor(config: PostgresIdentityRepositoryConfig) {
    this.pool = config.pool;
  }

  async upsertUser(lookup: UserIdentityLookup): Promise<User> {
    const result = await this.pool.query(
      `INSERT INTO identity.users (id, email, name, tenant_id)
       VALUES ($1::UUID, $2, $3, $1::TEXT)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, email, name, tenant_id, created_at`,
      [lookup.id, lookup.email, lookup.name],
    );
    const row = result.rows[0];
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      tenantId: asTenantId(row.tenant_id ?? row.id),
      createdAt: new Date(row.created_at),
    };
  }

  async findUserByEmail(email: string): Promise<User | null> {
    const result = await this.pool.query(
      `SELECT id, email, name, tenant_id, created_at FROM identity.users WHERE email = $1`,
      [email],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return mapUser(row);
  }

  async findUserById(userId: string): Promise<User | null> {
    const result = await this.pool.query(
      `SELECT id, email, name, tenant_id, created_at FROM identity.users WHERE id = $1`,
      [userId],
    );
    if (result.rows.length === 0) return null;
    return mapUser(result.rows[0]);
  }

  async createWorkspace(name: string, ownerUserId: string): Promise<Workspace> {
    const tenantId = asTenantId(ownerUserId);
    return this.withTransaction(async (client) => {
      await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId as string]);
      const workspaceId = randomUUID();
      const wResult = await client.query(
        `INSERT INTO identity.workspaces (id, tenant_id, name, owner_user_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, tenant_id, name, owner_user_id, created_at`,
        [workspaceId, tenantId as string, name, ownerUserId],
      );
      await client.query(
        `INSERT INTO identity.memberships (workspace_id, tenant_id, user_id, role)
         VALUES ($1, $2, $3, 'OWNER')
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
        [workspaceId, tenantId as string, ownerUserId],
      );
      const row = wResult.rows[0];
      return {
        id: row.id,
        name: row.name,
        tenantId: asTenantId(row.tenant_id),
        ownerUserId: row.owner_user_id,
        createdAt: new Date(row.created_at),
      };
    });
  }

  async findWorkspaceById(workspaceId: string, tenantId: TenantId): Promise<Workspace | null> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT id, tenant_id, name, owner_user_id, created_at
         FROM identity.workspaces
         WHERE id = $1`,
        [workspaceId],
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        id: row.id,
        name: row.name,
        tenantId: asTenantId(row.tenant_id),
        ownerUserId: row.owner_user_id,
        createdAt: new Date(row.created_at),
      };
    });
  }

  async listWorkspacesForUser(userId: string): Promise<Workspace[]> {
    return this.withTenant(asTenantId(userId), async (client) => {
      const result = await client.query(
        `SELECT w.id, w.tenant_id, w.name, w.owner_user_id, w.created_at
         FROM identity.workspaces w
         JOIN identity.memberships m ON m.workspace_id = w.id
         WHERE m.user_id = $1::UUID`,
        [userId],
      );
      return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        tenantId: asTenantId(row.tenant_id),
        ownerUserId: row.owner_user_id,
        createdAt: new Date(row.created_at),
      }));
    });
  }

  async addMember(
    workspaceId: string,
    tenantId: TenantId,
    userId: string,
    role: WorkspaceRole,
  ): Promise<Membership> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO identity.memberships (workspace_id, tenant_id, user_id, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role
         RETURNING workspace_id, user_id, role, created_at`,
        [workspaceId, tenantId as string, userId, role],
      );
      const row = result.rows[0];
      return {
        workspaceId: row.workspace_id,
        userId: row.user_id,
        role: row.role,
        createdAt: new Date(row.created_at),
      };
    });
  }

  async listMembers(workspaceId: string, tenantId: TenantId): Promise<WorkspaceMembersResult> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT u.id as user_id, u.email, u.name, m.role
         FROM identity.memberships m
         JOIN identity.users u ON u.id = m.user_id
         WHERE m.workspace_id = $1`,
        [workspaceId],
      );
      return {
        workspaceId,
        members: result.rows.map((row) => ({
          userId: row.user_id,
          email: row.email,
          name: row.name,
          role: row.role,
        })),
      };
    });
  }

  async isMember(workspaceId: string, tenantId: TenantId, userId: string): Promise<boolean> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT 1 FROM identity.memberships
         WHERE workspace_id = $1 AND user_id = $2
         LIMIT 1`,
        [workspaceId, userId],
      );
      return result.rows.length > 0;
    });
  }

  private async withTenant<T>(tenantId: TenantId, operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId as string]);
      return await operation(client);
    } finally {
      await client.query(`SELECT set_config('app.current_tenant', '', false)`).catch(() => {});
      client.release();
    }
  }

  private async withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}

function mapUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    email: row.email as string,
    name: (row.name as string | null) ?? null,
    tenantId: asTenantId((row.tenant_id as string) ?? (row.id as string)),
    createdAt: new Date(row.created_at as string),
  };
}
