import type { Pool } from 'pg';
import { Mission } from '@projectx/domain';
import type { MissionBudget, MissionConstraints, MissionOutcomes, MissionPlan, MissionStatus, MissionSuccessCriteria, MissionTask } from '@projectx/domain';
import type { MissionId, TenantId, UserId } from '@projectx/shared';
import { PostgresRepository, toDate } from '@projectx/infrastructure';
import type { IMissionRepository } from '../ports/mission-repository.interface';

export interface PostgresMissionRepositoryConfig {
  pool: Pool;
}

type MissionSnapshot = {
  id?: MissionId;
  tenantId?: TenantId;
  name: string;
  objective: string;
  icpId: string;
  territory: string[];
  channels: string[];
  budget: unknown;
  autonomyLevel: number;
  constraints: unknown;
  successCriteria: unknown;
  deadline?: Date;
  ownerUserId: string;
  plan: unknown;
  status: string;
  tasks: unknown[];
  approvals: unknown[];
  outcomes?: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export class PostgresMissionRepository implements IMissionRepository {
  private readonly repository: PostgresRepository<Mission, MissionSnapshot, MissionId>;

  constructor(config: PostgresMissionRepositoryConfig) {
    this.repository = new PostgresRepository<Mission, MissionSnapshot, MissionId>(
      { pool: config.pool, tableName: 'mission.missions' },
      {
        toSnapshot: (entity) => ({
          id: entity.id,
          tenantId: entity.tenantId,
          name: entity.name,
          objective: entity.objective,
          icpId: entity.icpId,
          territory: entity.territory,
          channels: entity.channels,
          budget: entity.budget,
          autonomyLevel: entity.autonomyLevel,
          constraints: entity.constraints,
          successCriteria: entity.successCriteria,
          deadline: entity.deadline,
          ownerUserId: entity.ownerUserId,
          plan: entity.plan,
          status: entity.status,
          tasks: entity.tasks as unknown[],
          approvals: [...entity.approvals],
          outcomes: entity.outcomes,
          createdAt: entity.createdAt,
          updatedAt: entity.updatedAt,
        }),
        fromSnapshot: (snapshot, id, tenantId, version) =>
          Mission.reconstitute(
            {
              ...snapshot,
              id,
              tenantId: tenantId as TenantId,
              status: snapshot.status as MissionStatus,
              ownerUserId: snapshot.ownerUserId as UserId,
              budget: snapshot.budget as MissionBudget,
              constraints: snapshot.constraints as MissionConstraints,
              successCriteria: snapshot.successCriteria as MissionSuccessCriteria,
              plan: snapshot.plan as MissionPlan,
              // NOTE: tasks arrive as plain JSON objects after JSONB round-trip,
              // not real MissionTask instances (no .transitionStatus() method).
              // See docs/reports/phase14-persistence-repair-report.md — known
              // remaining gap, tracked for a dedicated follow-up fix.
              tasks: snapshot.tasks as unknown as MissionTask[],
              outcomes: snapshot.outcomes as MissionOutcomes | undefined,
              deadline: toDate(snapshot.deadline),
              createdAt: toDate(snapshot.createdAt),
              updatedAt: toDate(snapshot.updatedAt),
            },
            version,
          ),
      },
    );
  }

  async load(tenantId: TenantId, missionId: string): Promise<Mission | null> {
    return this.repository.findById({ tenantId, correlationId: '' as string }, missionId as MissionId);
  }

  async save(mission: Mission): Promise<void> {
    await this.repository.save(
      { tenantId: mission.tenantId, correlationId: '' as string },
      mission,
    );
  }
}
