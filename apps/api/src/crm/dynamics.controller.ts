import { BadRequestException, Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { asCorrelationId } from '@projectx/shared';
import { CurrentUser, JwtAuthGuard, PermissionsGuard, RequirePermissions, TenantGuard, type RequestUser } from '../identity/auth.guard';
import { DYNAMICS_QUERY_SERVICE } from './dynamics.module';
import { DynamicsQueryService } from './dynamics-query.service';

@Controller('crm/dynamics')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@RequirePermissions('workspace:read')
export class DynamicsController {
  constructor(@Inject(DYNAMICS_QUERY_SERVICE) private readonly queryService: DynamicsQueryService) {}

  @Get('accounts')
  accounts(@CurrentUser() user: RequestUser, @Query('name') name?: string, @Query('domain') domain?: string, @Query('industry') industry?: string, @Query('limit') rawLimit = '25') {
    const limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException('Invalid limit');
    return this.queryService.accounts(this.ctx(user), { name: this.optional(name), domain: this.optional(domain), industry: this.optional(industry), limit });
  }

  @Get('accounts/:accountId/contacts')
  contacts(@CurrentUser() user: RequestUser, @Param('accountId') accountId: string) {
    if (!/^[0-9a-fA-F-]{36}$/.test(accountId)) throw new BadRequestException('Invalid account ID');
    return this.queryService.contacts(this.ctx(user), accountId);
  }

  private ctx(user: RequestUser) { return { tenantId: user.tenantId, workspaceId: user.workspaceId, userId: user.userId, correlationId: asCorrelationId(`dynamics:${user.userId}`) }; }
  private optional(value?: string): string | undefined { if (value === undefined) return undefined; if (!value.trim() || value.length > 500) throw new BadRequestException('Invalid query'); return value.trim(); }
}
