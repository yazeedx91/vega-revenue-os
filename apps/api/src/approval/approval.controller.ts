import { BadRequestException, Body, Controller, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ApprovalApplicationService } from '@projectx/mission-orchestrator';
import type { TenantContext } from '@projectx/domain';
import { asCorrelationId } from '@projectx/shared';
import { APPROVAL_SERVICE } from './approval.module';
import { CurrentUser, JwtAuthGuard, PermissionsGuard, RequirePermissions, TenantGuard, type RequestUser } from '../identity/auth.guard';

export interface ApprovalDecisionBody {
  readonly reason: string;
}

@Controller('approvals')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class ApprovalController {
  constructor(@Inject(APPROVAL_SERVICE) private readonly approvalService: ApprovalApplicationService) {}

  @RequirePermissions('approval:respond')
  @Post(':approvalId/approve')
  async approve(
    @CurrentUser() user: RequestUser,
    @Param('approvalId', new ParseUUIDPipe({ version: '4' })) approvalId: string,
    @Body() body: ApprovalDecisionBody,
  ): Promise<{ status: string }> {
    await this.approvalService.approve(this.buildContext(user), { approvalId, actorId: user.userId, reason: this.reason(body.reason), decision: 'APPROVED' });
    return { status: 'APPROVED' };
  }

  @RequirePermissions('approval:respond')
  @Post(':approvalId/reject')
  async reject(
    @CurrentUser() user: RequestUser,
    @Param('approvalId', new ParseUUIDPipe({ version: '4' })) approvalId: string,
    @Body() body: ApprovalDecisionBody,
  ): Promise<{ status: string }> {
    await this.approvalService.reject(this.buildContext(user), { approvalId, actorId: user.userId, reason: this.reason(body.reason), decision: 'REJECTED' });
    return { status: 'REJECTED' };
  }

  private buildContext(user: RequestUser): TenantContext {
    return { tenantId: user.tenantId, workspaceId: user.workspaceId, userId: user.userId, correlationId: asCorrelationId(randomUUID()) };
  }

  private reason(value: string): string {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > 1000) throw new BadRequestException('Decision reason must be 1-1000 characters');
    return value.trim();
  }
}
