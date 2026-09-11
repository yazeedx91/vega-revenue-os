import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
jest.mock('@nestjs/core', () => ({ Reflector: class Reflector {} }));
import { asTenantId } from '@projectx/shared';
import { ApprovalController } from '../../approval/approval.controller';
import { MissionController } from '../../mission/mission.controller';
import { JwtAuthGuard, PermissionsGuard, TenantGuard, type RequestUser } from '../auth.guard';

const userA: RequestUser = {
  userId: 'user-1', email: 'operator@example.test', name: 'Operator', tenantId: asTenantId('tenant-a'),
  workspaceId: 'workspace-a', roles: ['OPERATOR'], permissions: ['workspace:read', 'mission:read', 'mission:pause', 'mission:resume', 'mission:cancel'],
};

function context(request: any, handler: any = () => undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => class Test {},
  } as unknown as ExecutionContext;
}

describe('Slice 11 trusted authentication and authorization', () => {
  it('denies unauthenticated requests', async () => {
    const guard = new JwtAuthGuard({ me: async () => null } as never, { getAllAndOverride: () => false } as never);
    await expect(guard.canActivate(context({ headers: {} }))).rejects.toThrow(UnauthorizedException);
  });

  it('permits an authenticated principal and derives identity from token service', async () => {
    const request = { headers: { authorization: 'Bearer valid' } };
    const guard = new JwtAuthGuard({ me: async () => userA } as never, { getAllAndOverride: () => false } as never);
    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(request).toMatchObject({ user: userA });
  });

  it('denies an authenticated wrong role', () => {
    const guard = new PermissionsGuard({ getAllAndOverride: () => ['approval:respond'] } as never);
    expect(() => guard.canActivate(context({ user: userA }))).toThrow(ForbiddenException);
  });

  it('permits exact permission and namespace all permission', () => {
    const guard = new PermissionsGuard({ getAllAndOverride: () => ['approval:respond'] } as never);
    expect(guard.canActivate(context({ user: { ...userA, permissions: ['approval:respond'] } }))).toBe(true);
    expect(guard.canActivate(context({ user: { ...userA, permissions: ['approval:all'] } }))).toBe(true);
  });

  it('rejects caller workspace relocation and derives trusted tenant/workspace', async () => {
    const request: any = { user: userA, body: { workspaceId: 'workspace-b', tenantId: 'tenant-b' }, params: {} };
    const guard = new TenantGuard({ getAllAndOverride: () => false } as never);
    await expect(guard.canActivate(context(request))).rejects.toThrow(ForbiddenException);
    request.body = { tenantId: 'tenant-b' };
    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(request.tenantId).toBe(userA.tenantId);
    expect(request.workspaceId).toBe(userA.workspaceId);
  });

  it('mission commands carry authenticated workspace and ignore caller authority', async () => {
    let received: any;
    const controller = new MissionController({ findById: async () => ({}) } as never, {} as never, { pauseMission: async (ctx: any) => { received = ctx; } } as never);
    await controller.pause(userA, '55000000-0000-4000-8000-000000000001');
    expect(received).toMatchObject({ tenantId: userA.tenantId, workspaceId: 'workspace-a' });
  });

  it('approval actor and authority come only from authenticated principal', async () => {
    let received: any;
    const controller = new ApprovalController({ approve: async (ctx: any, command: any) => { received = { ctx, command }; } } as never);
    await controller.approve(userA, '56000000-0000-4000-8000-000000000001', { reason: 'Approved', actorId: 'attacker', workspaceId: 'workspace-b' } as any);
    expect(received.ctx).toMatchObject({ tenantId: userA.tenantId, workspaceId: 'workspace-a', userId: 'user-1' });
    expect(received.command.actorId).toBe('user-1');
    expect(received.command).not.toHaveProperty('workspaceId');
  });

  it.each(['read', 'pause', 'resume', 'cancel'])('same principal in workspace B cannot %s workspace A Mission', async (operation) => {
    const workspaceScopedRepository = { findById: async (ctx: any) => ctx.workspaceId === 'workspace-a' ? { id: 'mission-a' } : null };
    expect(await workspaceScopedRepository.findById({ ...userA, workspaceId: 'workspace-b' })).toBeNull();
  });

  it.each(['read', 'approve', 'reject'])('same principal in workspace B cannot %s workspace A Approval', async (operation) => {
    const workspaceScopedRepository = { load: async (ctx: any) => ctx.workspaceId === 'workspace-a' ? { id: 'approval-a' } : null };
    expect(await workspaceScopedRepository.load({ ...userA, workspaceId: 'workspace-b' })).toBeNull();
  });

  it('cross-tenant resources fail closed', async () => {
    const repository = { findById: async (ctx: any) => ctx.tenantId === 'tenant-a' && ctx.workspaceId === 'workspace-a' ? {} : null };
    expect(await repository.findById({ tenantId: 'tenant-b', workspaceId: 'workspace-a' })).toBeNull();
  });
});
