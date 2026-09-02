import type { Pool, PoolClient } from 'pg';
import { Actor, Mission, MissionTask } from '@projectx/domain';
import type {
  MissionBudget,
  MissionConstraints,
  MissionOutcomes,
  MissionPlan,
  MissionSuccessCriteria,
  TenantContext,
} from '@projectx/domain';
import {
  asCorrelationId,
  asIdempotencyKey,
  asMissionId,
  asTaskId,
  asTenantId,
  asUserId,
  type TenantId,
  type UserId,
} from '@projectx/shared';
import { ConcurrencyConflictError, PostgresClient } from '@projectx/infrastructure';
import type { IMissionRepository } from '../ports/mission-repository.interface';

export interface PostgresMissionRepositoryConfig {
  pool: Pool;
}

export interface PersistedTask {
  taskId: string;
  status: string;
  output?: unknown;
  startedAt?: Date;
  completedAt?: Date;
}

export class PostgresMissionRepository implements IMissionRepository {
  private readonly client: PostgresClient;

  constructor(config: PostgresMissionRepositoryConfig) {
    this.client = new PostgresClient(config.pool);
  }

  async findById(ctx: TenantContext, missionId: string): Promise<Mission | null> {
    return this.client.transaction(ctx, async (client) => {
      const missionResult = await client.query(
        `SELECT id, tenant_id, owner_user_id, name, objective, icp_id, territory, channels,
                budget, autonomy_level, constraints, success_criteria, deadline, status,
                current_plan_version, outcomes, version, created_at, updated_at
         FROM mission.missions
         WHERE id = $1::UUID`,
        [missionId],
      );

      if (missionResult.rows.length === 0) {
        return null;
      }

      const row = missionResult.rows[0];
      const currentVersion = row.current_plan_version as number;

      const planResult = await client.query(
        `SELECT plan_id, version, objectives, phases, approval_gates, fallback_branches
         FROM mission.plans
         WHERE mission_id = $1::UUID AND version = $2 AND is_current = true`,
        [missionId, currentVersion],
      );

      const tasksResult = await client.query(
        `SELECT task_id, agent_id, agent_version, task_type, required_capability, input,
                approval_gate_id, deadline
         FROM mission.tasks
         WHERE mission_id = $1::UUID AND plan_version = $2`,
        [missionId, currentVersion],
      );

      const depsResult = await client.query(
        `SELECT task_id, depends_on_task_id
         FROM mission.task_dependencies
         WHERE mission_id = $1::UUID AND plan_version = $2`,
        [missionId, currentVersion],
      );

      const stateResult = await client.query(
        `SELECT task_id, status, output, started_at, completed_at
         FROM mission.task_execution_state
         WHERE mission_id = $1::UUID AND plan_version = $2`,
        [missionId, currentVersion],
      );

      const depsByTask = new Map<string, string[]>();
      for (const dep of depsResult.rows) {
        const taskId = dep.task_id as string;
        if (!depsByTask.has(taskId)) depsByTask.set(taskId, []);
        depsByTask.get(taskId)!.push(dep.depends_on_task_id as string);
      }

      const stateByTask = new Map<string, PersistedTask>();
      for (const s of stateResult.rows) {
        stateByTask.set(s.task_id as string, {
          taskId: s.task_id as string,
          status: s.status as string,
          output: s.output ? (s.output as unknown) : undefined,
          startedAt: s.started_at ? new Date(s.started_at as string) : undefined,
          completedAt: s.completed_at ? new Date(s.completed_at as string) : undefined,
        });
      }

      const planRow = planResult.rows[0];
      const plan: MissionPlan = {
        planId: planRow ? (planRow.plan_id as string) : `${missionId}-plan`,
        version: currentVersion,
        objectives: planRow ? (planRow.objectives as unknown[]) : [],
        phases: planRow ? (planRow.phases as unknown[]) : [],
        approvalGates: planRow ? (planRow.approval_gates as unknown[]) : [],
        fallbackBranches: planRow ? (planRow.fallback_branches as unknown[]) : [],
      };

      const tenant = asTenantId(row.tenant_id as string);
      const actor = Actor.system('mission-orchestrator', tenant);
      const tasks: MissionTask[] = tasksResult.rows.map((t) => {
        const taskId = asTaskId(t.task_id as string);
        const state = stateByTask.get(t.task_id as string);
        const task = new MissionTask({
          id: taskId,
          missionId: asMissionId(row.id as string),
          planId: plan.planId,
          agentId: t.agent_id as string,
          agentVersion: t.agent_version as string,
          taskType: t.task_type as string,
          input: t.input as unknown,
          dependsOn: (depsByTask.get(t.task_id as string) ?? []).map(asTaskId),
          deadline: t.deadline ? new Date(t.deadline as string) : undefined,
          approvalGateId: (t.approval_gate_id as string) ?? undefined,
          idempotencyKey: asIdempotencyKey(t.task_id as string),
          correlationId: asCorrelationId('reconstituted'),
          actor,
        });
        if (state) {
          task.status = state.status as MissionTask['status'];
          task.output = state.output;
          task.startedAt = state.startedAt;
          task.completedAt = state.completedAt;
        }
        return task;
      });

      const mission = Mission.reconstitute(
        {
          id: asMissionId(row.id as string),
          tenantId: tenant,
          name: row.name as string,
          objective: row.objective as string,
          icpId: row.icp_id as string,
          territory: row.territory as string[],
          channels: row.channels as string[],
          budget: row.budget as MissionBudget,
          autonomyLevel: row.autonomy_level as number,
          constraints: row.constraints as MissionConstraints,
          successCriteria: row.success_criteria as MissionSuccessCriteria,
          deadline: row.deadline ? new Date(row.deadline as string) : undefined,
          ownerUserId: asUserId(row.owner_user_id as string),
          plan,
          status: row.status as Mission['status'],
          tasks,
          approvals: [],
          outcomes: row.outcomes as MissionOutcomes,
          createdAt: new Date(row.created_at as string),
          updatedAt: new Date(row.updated_at as string),
        },
        row.version as number,
      );

      return mission;
    });
  }

  async save(ctx: TenantContext, mission: Mission): Promise<void> {
    await this.client.transaction(ctx, async (client) => {
      const existing = await client.query(
        `SELECT version, current_plan_version FROM mission.missions WHERE id = $1::UUID`,
        [mission.id],
      );

      const loadedVersion = existing.rows[0]?.version as number | undefined;
      const currentDbVersion = existing.rows[0]?.current_plan_version as number | undefined;
      const newVersion = mission.version;
      const planVersion = mission.plan.version;

      if (loadedVersion === undefined) {
        const result = await client.query(
          `INSERT INTO mission.missions
             (id, tenant_id, owner_user_id, name, objective, icp_id, territory, channels,
              budget, autonomy_level, constraints, success_criteria, deadline, status,
              current_plan_version, outcomes, workflow_id, workflow_run_id, version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
           ON CONFLICT (id) DO NOTHING
           RETURNING id`,
          [
            mission.id,
            ctx.tenantId as string,
            mission.ownerUserId,
            mission.name,
            mission.objective,
            mission.icpId,
            mission.territory,
            mission.channels,
            JSON.stringify(mission.budget),
            mission.autonomyLevel,
            JSON.stringify(mission.constraints),
            JSON.stringify(mission.successCriteria),
            mission.deadline ?? null,
            mission.status,
            planVersion,
            JSON.stringify(mission.outcomes ?? {}),
            null,
            null,
            newVersion,
          ],
        );
        if (result.rowCount === 0) {
          throw new ConcurrencyConflictError(
            `Insert failed: mission ${mission.id} already exists`,
            ctx.tenantId as string,
            mission.id,
            undefined,
          );
        }
      } else {
        const result = await client.query(
          `UPDATE mission.missions
           SET tenant_id = $2,
               owner_user_id = $3,
               name = $4,
               objective = $5,
               icp_id = $6,
               territory = $7,
               channels = $8,
               budget = $9,
               autonomy_level = $10,
               constraints = $11,
               success_criteria = $12,
               deadline = $13,
               status = $14,
               current_plan_version = $15,
               outcomes = $16,
               workflow_id = $17,
               workflow_run_id = $18,
               version = $19,
               updated_at = NOW()
           WHERE id = $1 AND version = $20`,
          [
            mission.id,
            ctx.tenantId as string,
            mission.ownerUserId,
            mission.name,
            mission.objective,
            mission.icpId,
            mission.territory,
            mission.channels,
            JSON.stringify(mission.budget),
            mission.autonomyLevel,
            JSON.stringify(mission.constraints),
            JSON.stringify(mission.successCriteria),
            mission.deadline ?? null,
            mission.status,
            planVersion,
            JSON.stringify(mission.outcomes ?? {}),
            null,
            null,
            newVersion,
            loadedVersion,
          ],
        );
        if (result.rowCount === 0) {
          throw new ConcurrencyConflictError(
            `Update failed: expected version ${loadedVersion} for mission ${mission.id} is stale`,
            ctx.tenantId as string,
            mission.id,
            loadedVersion,
          );
        }
      }

      if (currentDbVersion === undefined || currentDbVersion !== planVersion) {
        await client.query(
          `UPDATE mission.plans SET is_current = false WHERE mission_id = $1::UUID`,
          [mission.id],
        );

        await client.query(
          `INSERT INTO mission.plans
             (tenant_id, mission_id, version, plan_id, is_current, objectives, phases, approval_gates, fallback_branches)
           VALUES ($1, $2, $3, $4, true, $5, $6, $7, $8)
           ON CONFLICT (mission_id, version) DO NOTHING`,
          [
            ctx.tenantId as string,
            mission.id,
            planVersion,
            mission.plan.planId,
            JSON.stringify(mission.plan.objectives),
            JSON.stringify(mission.plan.phases),
            JSON.stringify(mission.plan.approvalGates),
            JSON.stringify(mission.plan.fallbackBranches),
          ],
        );

        for (const task of mission.tasks) {
          await this.upsertTaskDefinition(client, ctx.tenantId as string, mission.id, planVersion, task);
        }
      }

      for (const task of mission.tasks) {
        await this.upsertTaskExecutionState(client, ctx.tenantId as string, mission.id, planVersion, task);
      }

      mission.setVersion(newVersion);
    });
  }

  private async upsertTaskDefinition(
    client: PoolClient,
    tenantId: string,
    missionId: string,
    planVersion: number,
    task: MissionTask,
  ): Promise<void> {
    await client.query(
      `INSERT INTO mission.tasks
         (tenant_id, mission_id, plan_version, task_id, agent_id, agent_version, task_type,
          required_capability, input, approval_gate_id, deadline)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (mission_id, plan_version, task_id) DO NOTHING`,
      [
        tenantId,
        missionId,
        planVersion,
        task.id,
        task.agentId,
        task.agentVersion,
        task.taskType,
        task.agentId,
        JSON.stringify(task.input),
        task.approvalGateId ?? null,
        task.deadline ?? null,
      ],
    );

    for (const dep of task.dependsOn) {
      await client.query(
        `INSERT INTO mission.task_dependencies
           (tenant_id, mission_id, plan_version, task_id, depends_on_task_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (mission_id, plan_version, task_id, depends_on_task_id) DO NOTHING`,
        [tenantId, missionId, planVersion, task.id, dep],
      );
    }
  }

  private async upsertTaskExecutionState(
    client: PoolClient,
    tenantId: string,
    missionId: string,
    planVersion: number,
    task: MissionTask,
  ): Promise<void> {
    await client.query(
      `INSERT INTO mission.task_execution_state
         (tenant_id, mission_id, plan_version, task_id, status, output, started_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (mission_id, plan_version, task_id)
       DO UPDATE SET status = EXCLUDED.status,
                     output = EXCLUDED.output,
                     started_at = EXCLUDED.started_at,
                     completed_at = EXCLUDED.completed_at,
                     updated_at = NOW()`,
      [
        tenantId,
        missionId,
        planVersion,
        task.id,
        task.status,
        JSON.stringify(task.output ?? null),
        task.startedAt ?? null,
        task.completedAt ?? null,
      ],
    );
  }
}
