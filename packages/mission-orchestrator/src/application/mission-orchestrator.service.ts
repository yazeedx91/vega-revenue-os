import type { TenantContext } from '@projectx/domain';
import { ensureSameTenant } from '@projectx/domain';
import type { CorrelationId, EventId, IdempotencyKey, TenantId } from '@projectx/shared';
import { WorkflowIdFactory } from '@projectx/shared';
import { ConcurrencyConflictError } from '@projectx/infrastructure';
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
import type { MissionControlSignal } from '../workflow/mission-workflow.interfaces';

export interface MissionOrchestratorDependencies {
  missionRepository: IMissionRepository;
  eventBus: IEventBus;
  workflowClient: IWorkflowClient;
  idempotencyStore: IIdempotencyStore;
  generateIdempotencyKey: (hint: string) => IdempotencyKey;
  generateEventId: () => EventId;
  generateCorrelationId: () => CorrelationId;
  workflowType?: string;
  taskQueue?: string;
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

    const workflowType = this.deps.workflowType ?? 'MissionWorkflow';
    const taskQueue = this.deps.taskQueue ?? 'mission-execution';

    await this.deps.workflowClient.start(
      ctx,
      workflowType,
      {
        tenantId: ctx.tenantId,
        workspaceId: mission.workspaceId!,
        userId: ctx.userId ?? String(mission.ownerUserId),
        missionId: cmd.missionId,
        correlationId,
      },
      { timeoutSeconds: 86400, workflowId, taskQueue },
    );

    return { workflowId, correlationId };
  }

  async pauseMission(ctx: TenantContext, cmd: PauseMissionCommand): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const mission = await this.loadMission(ctx, cmd.missionId);
        if (mission.status === 'PAUSED') {
          return;
        }
        if (mission.status !== 'PLANNING' && mission.status !== 'EXECUTING') {
          throw new Error(`Cannot pause mission ${cmd.missionId}: mission is ${mission.status}`);
        }
        const eventId = this.deps.generateEventId();
        const correlationId = this.deps.generateCorrelationId();
        const result = mission.pause(cmd.reason, correlationId, eventId);
        if (!result.success) {
          throw new Error(`Cannot pause mission: ${result.error.message}`);
        }
        await this.saveAndPublish(ctx, mission);
        break;
      } catch (err) {
        if (err instanceof ConcurrencyConflictError && attempt < 2) {
          continue;
        }
        throw err;
      }
    }
    await this.signalWorkflow(ctx, cmd.missionId, { action: 'PAUSE', reason: cmd.reason });
  }

  async resumeMission(ctx: TenantContext, cmd: ResumeMissionCommand): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const mission = await this.loadMission(ctx, cmd.missionId);
        if (mission.status === 'EXECUTING') {
          return;
        }
        if (mission.status !== 'PAUSED') {
          throw new Error(`Cannot resume mission ${cmd.missionId}: mission is ${mission.status}`);
        }
        const eventId = this.deps.generateEventId();
        const correlationId = this.deps.generateCorrelationId();
        const result = mission.resume(correlationId, eventId);
        if (!result.success) {
          throw new Error(`Cannot resume mission: ${result.error.message}`);
        }
        await this.saveAndPublish(ctx, mission);
        break;
      } catch (err) {
        if (err instanceof ConcurrencyConflictError && attempt < 2) {
          continue;
        }
        throw err;
      }
    }
    await this.signalWorkflow(ctx, cmd.missionId, { action: 'RESUME' });
  }

  async cancelMission(ctx: TenantContext, cmd: CancelMissionCommand): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const mission = await this.loadMission(ctx, cmd.missionId);
        if (this.isTerminal(mission.status)) {
          return;
        }
        const eventId = this.deps.generateEventId();
        const correlationId = this.deps.generateCorrelationId();
        const result = mission.cancel(cmd.reason, correlationId, eventId);
        if (!result.success) {
          throw new Error(`Cannot cancel mission: ${result.error.message}`);
        }
        await this.saveAndPublish(ctx, mission);
        break;
      } catch (err) {
        if (err instanceof ConcurrencyConflictError && attempt < 2) {
          continue;
        }
        throw err;
      }
    }
    await this.signalWorkflow(ctx, cmd.missionId, { action: 'CANCEL', reason: cmd.reason });
  }

  async replanMission(ctx: TenantContext, cmd: { missionId: string }): Promise<void> {
    const mission = await this.loadMission(ctx, cmd.missionId);
    if (this.isTerminal(mission.status)) {
      return;
    }
    await this.signalWorkflow(ctx, cmd.missionId, { action: 'REPLAN', reason: 'Dynamic replan' });
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
    control: MissionControlSignal,
  ): Promise<void> {
    const ref = {
      workflowId: WorkflowIdFactory.forMission(ctx.tenantId as string, missionId),
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId as CorrelationId,
    };
    await this.deps.workflowClient.signal(ctx, ref, 'control', control);
  }

  private isTerminal(status: string): boolean {
    return ['COMPLETED', 'FAILED', 'CANCELLED', 'ARCHIVED'].includes(status);
  }
}
