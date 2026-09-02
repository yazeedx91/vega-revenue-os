import { randomUUID } from 'crypto';
import {
  Mission,
  type IMissionRepository,
  type MissionBudget,
  type MissionConstraints,
  type MissionPlan,
  type MissionSuccessCriteria,
} from '@projectx/domain';
import {
  asMissionId,
  AuthorizationError,
  fail,
  type DomainError,
  type EventId,
  type Result,
  type UserId,
  ValidationError,
} from '@projectx/shared';
import type { CommandContext } from '../commands/command-context';
import { okOutcome, type CommandOutcome, type ICommandHandler } from '../commands/command-handler';
import type { IPolicyService } from '../ports/policy-service';

export interface CreateMissionCommand {
  readonly id: string;
  readonly name: string;
  readonly objective: string;
  readonly icpId: string;
  readonly territory: string[];
  readonly channels: string[];
  readonly budget: MissionBudget;
  readonly autonomyLevel: number;
  readonly constraints: MissionConstraints;
  readonly successCriteria: MissionSuccessCriteria;
  readonly deadline?: Date;
  readonly ownerUserId: UserId;
  readonly plan: MissionPlan;
}

export interface ApproveMissionCommand {
  readonly missionId: string;
}

export interface StartMissionCommand {
  readonly missionId: string;
}

export class CreateMissionHandler implements ICommandHandler<CreateMissionCommand, Mission> {
  constructor(private readonly missionRepository: IMissionRepository) {}

  async execute(
    ctx: CommandContext,
    command: CreateMissionCommand,
  ): Promise<Result<CommandOutcome<Mission>, DomainError>> {
    const missionId = asMissionId(command.id);
    const missionResult = Mission.create(
      {
        id: missionId,
        tenantId: ctx.tenantId,
        name: command.name,
        objective: command.objective,
        icpId: command.icpId,
        territory: command.territory,
        channels: command.channels,
        budget: command.budget,
        autonomyLevel: command.autonomyLevel,
        constraints: command.constraints,
        successCriteria: command.successCriteria,
        deadline: command.deadline,
        ownerUserId: command.ownerUserId,
        plan: command.plan,
      },
      ctx.correlationId,
      randomUUID() as EventId,
    );

    if (!missionResult.success) {
      return missionResult;
    }

    await this.missionRepository.save(ctx, missionResult.value);
    return { success: true, value: okOutcome(missionResult.value, 'Mission', missionResult.value.id) };
  }
}

export class ApproveMissionHandler implements ICommandHandler<ApproveMissionCommand, Mission> {
  constructor(
    private readonly missionRepository: IMissionRepository,
    private readonly policyService: IPolicyService,
  ) {}

  async execute(
    ctx: CommandContext,
    command: ApproveMissionCommand,
  ): Promise<Result<CommandOutcome<Mission>, DomainError>> {
    const missionId = asMissionId(command.missionId);
    const mission = await this.missionRepository.findById(ctx, missionId);
    if (!mission) {
      return fail(new ValidationError('Mission not found'));
    }

    const policyDecision = await this.policyService.evaluate(ctx, {
      actionType: 'ApproveMission',
      resourceType: 'Mission',
      resourceId: mission.id,
      riskCategory: 'MEDIUM',
      autonomyLevel: mission.autonomyLevel,
    });

    if (policyDecision === 'DENY') {
      return fail(new AuthorizationError('Policy denied mission approval'));
    }

    const result = mission.approve(ctx.actor, ctx.correlationId, randomUUID() as EventId);
    if (!result.success) {
      return result;
    }

    await this.missionRepository.save(ctx, mission);
    return { success: true, value: okOutcome(mission, 'Mission', mission.id) };
  }
}

export class StartMissionHandler implements ICommandHandler<StartMissionCommand, Mission> {
  constructor(
    private readonly missionRepository: IMissionRepository,
    private readonly policyService: IPolicyService,
  ) {}

  async execute(
    ctx: CommandContext,
    command: StartMissionCommand,
  ): Promise<Result<CommandOutcome<Mission>, DomainError>> {
    const missionId = asMissionId(command.missionId);
    const mission = await this.missionRepository.findById(ctx, missionId);
    if (!mission) {
      return fail(new ValidationError('Mission not found'));
    }

    const policyDecision = await this.policyService.evaluate(ctx, {
      actionType: 'StartMission',
      resourceType: 'Mission',
      resourceId: mission.id,
      riskCategory: 'HIGH',
      autonomyLevel: mission.autonomyLevel,
    });

    if (policyDecision === 'DENY') {
      return fail(new AuthorizationError('Policy denied mission start'));
    }

    const result = mission.start(ctx.correlationId, randomUUID() as EventId);
    if (!result.success) {
      return result;
    }

    await this.missionRepository.save(ctx, mission);
    return { success: true, value: okOutcome(mission, 'Mission', mission.id) };
  }
}
