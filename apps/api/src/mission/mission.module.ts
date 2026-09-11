import { randomUUID } from 'crypto';
import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { CreateMissionHandler } from '@projectx/application';
import {
  type IEventBus,
  type IWorkflowClient,
} from '@projectx/infrastructure';
import {
  MissionOrchestratorService,
  PostgresMissionRepository,
  InMemoryMissionRepository,
  InMemoryIdempotencyStore,
} from '@projectx/mission-orchestrator';
import { TemporalWorkflowClient } from '@projectx/temporal-client';
import {
  asEventId,
  asIdempotencyKey,
  asCorrelationId,
  type CorrelationId,
} from '@projectx/shared';
import { MissionController } from './mission.controller';
import { IdentityModule } from '../identity/identity.module';

const noOpEventBus: IEventBus = {
  publish: async () => {},
  sendCommand: async () => {},
  subscribe: async () => {},
};

function noOpWorkflowClient(): IWorkflowClient {
  return {
    start: async (ctx, _workflowType, _input, _options) => ({
      workflowId: 'noop',
      runId: undefined,
      tenantId: ctx.tenantId as string,
      correlationId: ctx.correlationId as CorrelationId,
      status: 'STARTED',
    }),
    signal: async () => {},
    query: async () => undefined as unknown as never,
    cancel: async () => {},
  };
}

@Module({
  imports: [IdentityModule],
  controllers: [MissionController],
  providers: [
    {
      provide: 'MISSION_REPOSITORY',
      useFactory: () => {
        if (process.env.DATABASE_URL) {
          return new PostgresMissionRepository({
            pool: new Pool({ connectionString: process.env.DATABASE_URL, max: 5 }),
          });
        }
        return new InMemoryMissionRepository();
      },
    },
    {
      provide: CreateMissionHandler,
      useFactory: (repo) => new CreateMissionHandler(repo),
      inject: ['MISSION_REPOSITORY'],
    },
    {
      provide: MissionOrchestratorService,
      useFactory: (repo, workflowClient) =>
        new MissionOrchestratorService({
          missionRepository: repo,
          eventBus: noOpEventBus,
          workflowClient,
          idempotencyStore: new InMemoryIdempotencyStore(),
          generateIdempotencyKey: (hint: string) => asIdempotencyKey(`${hint}:${randomUUID()}`),
          generateEventId: () => asEventId(randomUUID()),
          generateCorrelationId: () => asCorrelationId(randomUUID()),
          workflowType: process.env.MISSION_WORKFLOW_TYPE ?? 'MissionWorkflow',
          taskQueue: process.env.MISSION_TASK_QUEUE ?? 'mission-execution',
        }),
      inject: ['MISSION_REPOSITORY', 'WORKFLOW_CLIENT'],
    },
    {
      provide: 'WORKFLOW_CLIENT',
      useFactory: (): IWorkflowClient => {
        if (process.env.TEMPORAL_ADDRESS) {
          return new TemporalWorkflowClient({
            address: process.env.TEMPORAL_ADDRESS,
            namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
          });
        }
        return noOpWorkflowClient();
      },
    },
  ],
})
export class MissionModule {}
