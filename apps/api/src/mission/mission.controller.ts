import { randomUUID } from 'crypto';
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Actor, type MissionPlan, type TenantContext } from '@projectx/domain';
import { CreateMissionHandler } from '@projectx/application';
import { MissionOrchestratorService, mapMissionToContract, type IMissionRepository } from '@projectx/mission-orchestrator';
import {
  asCorrelationId,
  asEventId,
  asMissionId,
  asUserId,
  type MissionContract,
} from '@projectx/shared';
import { JwtAuthGuard, TenantGuard, PermissionsGuard, CurrentUser, RequirePermissions, type RequestUser } from '../identity/auth.guard';
import type { CreateMissionDto } from './mission.dto';

function buildContext(user: RequestUser): TenantContext {
  return {
    tenantId: user.tenantId,
    workspaceId: user.workspaceId,
    correlationId: asCorrelationId(randomUUID()),
  };
}

function buildCommandContext(user: RequestUser) {
  return {
    tenantId: user.tenantId,
    workspaceId: user.workspaceId,
    actor: Actor.human(asUserId(user.userId), user.tenantId),
    correlationId: asCorrelationId(randomUUID()),
  };
}

const INITIAL_PLAN: MissionPlan = {
  planId: '',
  version: 0,
  objectives: [],
  phases: [],
  approvalGates: [],
  fallbackBranches: [],
};

@Controller('missions')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class MissionController {
  constructor(
    private readonly missionRepository: IMissionRepository,
    private readonly createHandler: CreateMissionHandler,
    private readonly orchestrator: MissionOrchestratorService,
  ) {}

  @RequirePermissions('mission:execute')
  @Post()
  async create(
    @CurrentUser() user: RequestUser,
    @Body() body: CreateMissionDto,
  ): Promise<MissionContract> {
    const command = {
      id: randomUUID(),
      name: body.name,
      objective: body.objective,
      icpId: body.icpId,
      territory: body.territory ?? [],
      channels: body.channels ?? [],
      budget: { maxAiCostUsd: 0, ...(body.budget ?? {}) },
      autonomyLevel: body.autonomyLevel ?? 0,
      constraints: (body.constraints ?? {}) as import('@projectx/domain').MissionConstraints,
      successCriteria: (body.successCriteria ?? {}) as import('@projectx/domain').MissionSuccessCriteria,
      deadline: body.deadline ? new Date(body.deadline) : undefined,
      ownerUserId: asUserId(user.userId),
      plan: INITIAL_PLAN,
    };

    const result = await this.createHandler.execute(buildCommandContext(user), command);
    if (!result.success) {
      throw new HttpException(result.error.message, HttpStatus.BAD_REQUEST);
    }
    return mapMissionToContract(result.value.value);
  }

  @RequirePermissions('mission:read')
  @Get(':id')
  async getById(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<MissionContract> {
    const mission = await this.missionRepository.findById(buildContext(user), id);
    if (!mission) {
      throw new HttpException('Mission not found', HttpStatus.NOT_FOUND);
    }
    return mapMissionToContract(mission);
  }

  @RequirePermissions('mission:execute')
  @Post(':id/start')
  async start(@CurrentUser() user: RequestUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const ctx = buildContext(user);
    await this.requireMission(ctx, id);
    return this.orchestrator.startMission(ctx, { missionId: asMissionId(id) });
  }

  @RequirePermissions('mission:pause')
  @Post(':id/pause')
  async pause(@CurrentUser() user: RequestUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const ctx = buildContext(user);
    await this.requireMission(ctx, id);
    await this.orchestrator.pauseMission(ctx, { missionId: asMissionId(id), reason: 'User requested' });
    return { missionId: id, status: 'PAUSED' };
  }

  @RequirePermissions('mission:resume')
  @Post(':id/resume')
  async resume(@CurrentUser() user: RequestUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const ctx = buildContext(user);
    await this.requireMission(ctx, id);
    await this.orchestrator.resumeMission(ctx, { missionId: asMissionId(id) });
    return { missionId: id, status: 'EXECUTING' };
  }

  @RequirePermissions('mission:cancel')
  @Post(':id/cancel')
  async cancel(@CurrentUser() user: RequestUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const ctx = buildContext(user);
    await this.requireMission(ctx, id);
    await this.orchestrator.cancelMission(ctx, { missionId: asMissionId(id), reason: 'User requested' });
    return { missionId: id, status: 'CANCELLED' };
  }

  @RequirePermissions('mission:execute')
  @Post(':id/replan')
  async replan(@CurrentUser() user: RequestUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const ctx = buildContext(user);
    await this.requireMission(ctx, id);
    await this.orchestrator.replanMission(ctx, { missionId: asMissionId(id) });
    return { missionId: id, status: 'REPLANNING' };
  }

  private async requireMission(ctx: TenantContext, id: string): Promise<void> {
    if (!(await this.missionRepository.findById(ctx, id))) {
      throw new HttpException('Mission not found', HttpStatus.NOT_FOUND);
    }
  }
}
