import type { TenantContext } from '@projectx/domain';
import { ensureSameTenant } from '@projectx/domain';
import type { CorrelationId, EventId, IdempotencyKey, TenantId } from '@projectx/shared';
import { WorkflowIdFactory } from '@projectx/shared';
import type { IEventBus, IWorkflowClient } from '@projectx/infrastructure';
import type { Mission } from '@projectx/domain';
import type { IMissionRepository } from '../ports/mission-repository.interface';
import type { IIdempotencyStore } from '../ports/idempotency-store.interface';
import type {
  CancelMissionCommand,
  PauseMissionCommand,
  ResumeMissionCommand,
  StartMissionCommand,
} from './contracts';

export interface MissionOrchestratorDependencies {
  missionRepository: IMissionRepository;
  eventBus: IEventBus;
  workflowClient: IWorkflowClient;
  idempotencyStore: IIdempotencyStore;
  generateIdempotencyKey: (hint: string) => IdempotencyKey;
  generateEventId: () => EventId;
  generateCorrelationId: () => CorrelationId;
}

export class MissionOrchestratorService {
  constructor(private readonly deps: MissionOrchestratorDependencies) {}

  async startMission(
    ctx: TenantContext,
    cmd: StartMissionCommand,
  ): Promise<{ workflowId: string; correlationId: CorrelationId }> {
    const mission = await this.loadMission(ctx, cmd.missionId);
    const workflowId = WorkflowIdFactory.forMission(ctx.tenantId as string, cmd.missionId);

    const alreadyRunning = new Set(['PLANNING', 'EXECUTING']).has(mission.status);
    if (alreadyRunning) {
      return { workflowId, correlationId: ctx.correlationId as CorrelationId };
    }

    const eventId = this.deps.generateEventId();
    const correlationId = this.deps.generateCorrelationId();
    const result = mission.start(correlationId, eventId);
    if (!result.success) {
      throw new Error(`Cannot start mission: ${result.error.message}`);
    }

    await this.saveAndPublish(ctx, mission);

    await this.deps.workflowClient.start(
      ctx,
      'MissionExecutionWorkflow',
      {
        tenantId: ctx.tenantId,
        missionId: cmd.missionId,
        correlationId,
      },
      { timeoutSeconds: 86400, workflowId },
    );

    return { workflowId, correlationId };
  }

  async pauseMission(ctx: TenantContext, cmd: PauseMissionCommand): Promise<void> {
    const mission = await this.loadMission(ctx, cmd.missionId);
    const eventId = this.deps.generateEventId();
    const correlationId = this.deps.generateCorrelationId();
    const result = mission.pause(cmd.reason, correlationId, eventId);
    if (!result.success) {
      throw new Error(`Cannot pause mission: ${result.error.message}`);
    }
    await this.saveAndPublish(ctx, mission);
    await this.signalWorkflow(ctx, cmd.missionId, 'pause', { reason: cmd.reason });
  }

  async resumeMission(ctx: TenantContext, cmd: ResumeMissionCommand): Promise<void> {
    const mission = await this.loadMission(ctx, cmd.missionId);
    const eventId = this.deps.generateEventId();
    const correlationId = this.deps.generateCorrelationId();
    const result = mission.unblock(correlationId, eventId);
    if (!result.success) {
      throw new Error(`Cannot resume mission: ${result.error.message}`);
    }
    await this.saveAndPublish(ctx, mission);
    await this.signalWorkflow(ctx, cmd.missionId, 'resume', {});
  }

  async cancelMission(ctx: TenantContext, cmd: CancelMissionCommand): Promise<void> {
    const mission = await this.loadMission(ctx, cmd.missionId);
    const eventId = this.deps.generateEventId();
    const correlationId = this.deps.generateCorrelationId();
    const result = mission.cancel(cmd.reason, correlationId, eventId);
    if (!result.success) {
      throw new Error(`Cannot cancel mission: ${result.error.message}`);
    }
    await this.saveAndPublish(ctx, mission);
    await this.signalWorkflow(ctx, cmd.missionId, 'cancel', { reason: cmd.reason });
    await this.cancelWorkflow(ctx, cmd.missionId);
  }

  private async loadMission(ctx: TenantContext, missionId: string) {
    const mission = await this.deps.missionRepository.findById(ctx, missionId);
    if (!mission) {
      throw new Error(`Mission ${missionId} not found`);
    }
    ensureSameTenant(ctx, mission.tenantId);
    return mission;
  }

  private async saveAndPublish(ctx: TenantContext, mission: Mission): Promise<void> {
    await this.deps.missionRepository.save(ctx, mission);
    for (const event of mission.domainEvents) {
      await this.deps.eventBus.publish(event);
    }
    mission.clearDomainEvents();
  }

  private async signalWorkflow(
    ctx: TenantContext,
    missionId: string,
    signalName: string,
    payload: unknown,
  ): Promise<void> {
    const ref = {
      workflowId: WorkflowIdFactory.forMission(ctx.tenantId as string, missionId),
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId as CorrelationId,
    };
    await this.deps.workflowClient.signal(ctx, ref, signalName, payload);
  }

  private async cancelWorkflow(ctx: TenantContext, missionId: string): Promise<void> {
    const ref = {
      workflowId: WorkflowIdFactory.forMission(ctx.tenantId as string, missionId),
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId as CorrelationId,
    };
    await this.deps.workflowClient.cancel(ctx, ref);
  }
}
