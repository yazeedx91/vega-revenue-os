import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { GraphSubscriptionAdminService } from '@projectx/outreach';
import { asCorrelationId, asTenantId } from '@projectx/shared';
import type { TenantContext } from '@projectx/domain';
import { AdminApiKeyGuard } from './admin-api-key.guard';

class CreateSubscriptionDto {
  tenantId!: string;
  resource!: string;
  notificationUrl!: string;
  expirationDateTime!: string;
  clientState!: string;
}

@Controller('/admin/graph/subscriptions')
@UseGuards(AdminApiKeyGuard)
export class AdminGraphSubscriptionController {
  constructor(private readonly adminService: GraphSubscriptionAdminService) {}

  private ctx(tenantId: string): TenantContext {
    return {
      tenantId: asTenantId(tenantId),
      correlationId: asCorrelationId(`admin-graph-subscription-${Date.now()}`),
    };
  }

  @Post()
  async create(@Body() dto: CreateSubscriptionDto) {
    const result = await this.adminService.create({
      ctx: this.ctx(dto.tenantId),
      resource: dto.resource,
      notificationUrl: dto.notificationUrl,
      expirationDateTime: new Date(dto.expirationDateTime),
      clientState: dto.clientState,
    });

    if (!result.success) {
      return { status: 'ERROR', error: result.error };
    }
    return { status: 'CREATED', subscription: result.value };
  }

  @Get()
  async list(@Body('tenantId') tenantId: string) {
    const subscriptions = await this.adminService.list(this.ctx(tenantId));
    return { status: 'OK', subscriptions };
  }

  @Delete(':id')
  async delete(@Param('id') subscriptionId: string, @Body('tenantId') tenantId: string) {
    const result = await this.adminService.delete(this.ctx(tenantId), subscriptionId);
    if (!result.success) {
      return { status: 'ERROR', error: result.error };
    }
    return { status: 'DELETED' };
  }
}
