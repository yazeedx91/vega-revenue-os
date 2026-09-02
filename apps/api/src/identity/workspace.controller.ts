import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Inject,
  UseGuards,
  ForbiddenException,
  Headers,
} from '@nestjs/common';
import type { WorkspaceService, Workspace } from '@projectx/identity';
import type { WorkspaceRole } from '@projectx/identity';
import type { TenantId } from '@projectx/shared';
import { JwtAuthGuard, TenantGuard, PermissionsGuard, CurrentUser, RequirePermissions } from './auth.guard';
import type { RequestUser } from './auth.guard';

export interface CreateWorkspaceDto {
  name: string;
}

export interface InviteMemberDto {
  email: string;
  role: WorkspaceRole;
}

@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@Controller('workspaces')
export class WorkspaceController {
  constructor(@Inject('WORKSPACE_SERVICE') private readonly workspaceService: WorkspaceService) {}

  @Post()
  async create(
    @Body() dto: CreateWorkspaceDto,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @CurrentUser() user: RequestUser,
  ): Promise<Workspace> {
    return (await this.workspaceService.createWorkspace(
      { name: dto.name, ownerUserId: user.userId },
      correlationId,
    )) as Workspace;
  }

  @Get()
  async list(@CurrentUser() user: RequestUser): Promise<Workspace[]> {
    return this.workspaceService.listWorkspaces(user.userId);
  }

  @RequirePermissions('member:invite')
  @Post(':workspaceId/members')
  async invite(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: InviteMemberDto,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @CurrentUser() user: RequestUser,
  ): Promise<{ userId: string } | null> {
    if (workspaceId !== user.workspaceId) {
      throw new ForbiddenException('Cross-tenant workspace access denied');
    }
    return this.workspaceService.inviteMember(
      {
        workspaceId,
        tenantId: user.tenantId as TenantId,
        inviterUserId: user.userId,
        inviteeEmail: dto.email,
        role: dto.role,
      },
      correlationId,
    );
  }

  @Get(':workspaceId/members')
  async listMembers(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<unknown> {
    if (workspaceId !== user.workspaceId) {
      throw new ForbiddenException('Cross-tenant workspace access denied');
    }
    return this.workspaceService.listMembers(workspaceId, user.tenantId as TenantId, user.userId);
  }
}
