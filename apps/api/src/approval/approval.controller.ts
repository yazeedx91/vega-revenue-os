import { Body, Controller, Headers, Inject, Param, Post } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ApprovalApplicationService } from '@projectx/mission-orchestrator';
import type { TenantContext } from '@projectx/domain';
import type { CorrelationId, TenantId } from '@projectx/shared';
import { APPROVAL_SERVICE } from './approval.module';

export interface ApprovalDecisionBody {
  readonly actorId: string;
  readonly reason: string;
}

@Controller('approvals')
export class ApprovalController {
  constructor(@Inject(APPROVAL_SERVICE) private readonly approvalService: ApprovalApplicationService) {}

  @Post(':approvalId/approve')
  async approve(
    @Param('approvalId') approvalId: string,
    @Headers('x-tenant-id') tenantId: string,
    @Body() body: ApprovalDecisionBody,
  ): Promise<{ status: string }> {
    const ctx = this.buildContext(tenantId);
    await this.approvalService.approve(ctx, { approvalId, actorId: body.actorId, reason: body.reason, decision: 'APPROVED' });
    return { status: 'APPROVED' };
  }

  @Post(':approvalId/reject')
  async reject(
    @Param('approvalId') approvalId: string,
    @Headers('x-tenant-id') tenantId: string,
    @Body() body: ApprovalDecisionBody,
  ): Promise<{ status: string }> {
    const ctx = this.buildContext(tenantId);
    await this.approvalService.reject(ctx, { approvalId, actorId: body.actorId, reason: body.reason, decision: 'REJECTED' });
    return { status: 'REJECTED' };
  }

  private buildContext(tenantId: string): TenantContext {
    return {
      tenantId: tenantId as TenantId,
      correlationId: randomUUID() as CorrelationId,
    };
  }
}
