import { WorkspaceService } from '../application/workspace.service';
import { asTenantId } from '@projectx/shared';
import { FakeIdentityRepository } from './fake-identity-repository';

class FakeAuditLog {
  records: unknown[] = [];
  async record(_ctx: unknown, entry: unknown): Promise<void> {
    this.records.push(entry);
  }
}

class FakeTelemetry {
  metrics: unknown[] = [];
  increment(name: string, value?: number, _tags?: Record<string, string>) {
    this.metrics.push({ name, value });
  }
  span<T>(_: string, operation: () => Promise<T>): Promise<T> {
    return operation();
  }
  histogram(_: string, _v: number, _tags?: Record<string, string>) {}
  log(_: 'debug' | 'info' | 'warn' | 'error', _m: string, _meta?: Record<string, unknown>) {}
}

describe('WorkspaceService', () => {
  const repository = new FakeIdentityRepository();
  const audit = new FakeAuditLog();
  const telemetry = new FakeTelemetry();

  beforeEach(() => {
    repository['users'].clear();
    repository['emails'].clear();
    repository['workspaces'].clear();
    repository['memberships'].clear();
    audit.records = [];
    telemetry.metrics = [];
  });

  it('creates a workspace and lists it for the owner', async () => {
    const service = new WorkspaceService({
      repository,
      audit: audit as unknown as import('@projectx/infrastructure').IAuditLog,
      telemetry: telemetry as unknown as import('@projectx/infrastructure').ITelemetry,
    });

    const workspace = await service.createWorkspace({ name: 'Sales', ownerUserId: 'u-1' }, 'c-1');
    expect(workspace).not.toBeNull();

    const list = await service.listWorkspaces('u-1');
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('Sales');
  });

  it('invites a new member by email and records the membership', async () => {
    const service = new WorkspaceService({
      repository,
      audit: audit as unknown as import('@projectx/infrastructure').IAuditLog,
      telemetry: telemetry as unknown as import('@projectx/infrastructure').ITelemetry,
    });

    const workspace = await repository.createWorkspace('Eng', 'u-owner');
    await repository.upsertUser({ id: 'u-owner', email: 'owner@example.com', name: 'Owner' });

    const result = await service.inviteMember({
      workspaceId: workspace.id,
      tenantId: workspace.tenantId,
      inviterUserId: 'u-owner',
      inviteeEmail: 'new@example.com',
      role: 'MEMBER',
    });

    expect(result).not.toBeNull();
    const members = await service.listMembers(workspace.id, workspace.tenantId, 'u-owner');
    expect(members.members.some((m) => m.email === 'new@example.com' && m.role === 'MEMBER')).toBe(true);
    expect(audit.records.length).toBeGreaterThan(0);
  });
});
