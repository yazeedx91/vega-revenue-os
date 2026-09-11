import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import type { TenantContext } from '@projectx/domain';
import { asCorrelationId } from '@projectx/shared';
import { CurrentUser, JwtAuthGuard, PermissionsGuard, RequirePermissions, TenantGuard, type RequestUser } from '../identity/auth.guard';
import { OperatorApiService } from './operator-api.service';
import { ResourceIdPipe } from './resource-id.pipe';

@Controller('operator')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@RequirePermissions('workspace:read')
export class OperatorApiController {
  constructor(private readonly service: OperatorApiService) {}

  @Get('context')
  context(@CurrentUser() user: RequestUser) {
    return { userId: user.userId, tenantId: user.tenantId, workspaceId: user.workspaceId, roles: user.roles, permissions: user.permissions };
  }

  @Get('leads/:id')
  lead(@CurrentUser() user: RequestUser, @Param('id', ResourceIdPipe) id: string) { return this.service.lead(this.ctx(user), id); }

  @Get('campaigns/:id')
  campaign(@CurrentUser() user: RequestUser, @Param('id', ResourceIdPipe) id: string) { return this.service.campaign(this.ctx(user), id); }

  @Get('sequences/:id')
  sequence(@CurrentUser() user: RequestUser, @Param('id', ResourceIdPipe) id: string) { return this.service.sequence(this.ctx(user), id); }

  @Get('message-executions/:id')
  execution(@CurrentUser() user: RequestUser, @Param('id', ResourceIdPipe) id: string) { return this.service.execution(this.ctx(user), id); }

  @Get('conversations/:id')
  conversation(@CurrentUser() user: RequestUser, @Param('id', ResourceIdPipe) id: string) { return this.service.conversation(this.ctx(user), id); }

  @Get('approvals/:id')
  approval(@CurrentUser() user: RequestUser, @Param('id', ResourceIdPipe) id: string) { return this.service.approval(this.ctx(user), id); }

  private ctx(user: RequestUser): TenantContext {
    return { tenantId: user.tenantId, workspaceId: user.workspaceId, userId: user.userId, correlationId: asCorrelationId(`operator:${user.userId}`) };
  }
}
