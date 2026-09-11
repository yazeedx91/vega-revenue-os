import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  createParamDecorator,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService, type MeResult } from '@projectx/identity';
import { IS_PUBLIC_KEY } from '../shared/public.decorator';
import type { TenantId } from '@projectx/shared';

interface RequestWithUser extends Request {
  user?: RequestUser;
  tenantId?: TenantId;
  workspaceId?: string;
}

export const PERMISSIONS_KEY = 'required_permissions';

export function RequirePermissions(...permissions: string[]) {
  return Reflect.metadata(PERMISSIONS_KEY, permissions);
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestUser => {
  const request = ctx.switchToHttp().getRequest<RequestWithUser>();
  if (!request.user) throw new UnauthorizedException();
  return request.user;
});

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject('AUTH_SERVICE') private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractBearer(request);
    if (!token) {
      throw new UnauthorizedException('Bearer token required');
    }
    const user = await this.authService.me(token);
    if (!user) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    request.user = user as RequestUser;
    return true;
  }

  private extractBearer(request: RequestWithUser): string | undefined {
    const auth = request.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return undefined;
    return auth.slice(7);
  }
}

export interface RequestUser extends MeResult {}

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) throw new UnauthorizedException();

    // No caller-supplied tenant header is trusted; the tenant is always derived
    // from the authenticated workspace identity.
    const tenantId: TenantId = user.tenantId;
    const workspaceId = this.extractWorkspaceId(request);

    if (workspaceId && workspaceId !== user.workspaceId) {
      throw new ForbiddenException('Workspace does not match authenticated tenant');
    }

    request.tenantId = tenantId;
    request.workspaceId = user.workspaceId;
    return true;
  }

  private extractWorkspaceId(request: RequestWithUser): string | undefined {
    const fromBody = request.body?.workspaceId;
    if (typeof fromBody === 'string') return fromBody;
    const fromParam = request.params?.workspaceId;
    if (typeof fromParam === 'string') return fromParam;
    return undefined;
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) throw new UnauthorizedException();

    const has = required.some((permission) => {
      const namespace = permission.split(':')[0];
      return user.permissions.includes(permission) || user.permissions.includes(`${namespace}:all`);
    });
    if (!has) {
      throw new ForbiddenException('Missing required permission');
    }
    return true;
  }
}
