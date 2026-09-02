import type { MissionContract, TaskContract } from '@projectx/shared';
import type { Mission, MissionTask } from '@projectx/domain';

export function mapMissionToContract(mission: Mission): MissionContract {
  return {
    missionId: mission.id,
    tenantId: mission.tenantId,
    name: mission.name,
    objective: mission.objective,
    icpId: mission.icpId,
    territory: mission.territory,
    channels: mission.channels,
    budget: mission.budget,
    autonomyLevel: mission.autonomyLevel,
    constraints: mission.constraints,
    successCriteria: mission.successCriteria,
    deadline: mission.deadline,
    ownerUserId: mission.ownerUserId,
    status: mission.status,
    plan: {
      planId: mission.plan.planId,
      missionId: mission.id,
      version: mission.plan.version,
      objectives: mission.plan.objectives,
      phases: mission.plan.phases as unknown as MissionContract['plan']['phases'],
      approvalGates: mission.plan.approvalGates,
      fallbackBranches: mission.plan.fallbackBranches,
    },
    tasks: mission.tasks.map(mapMissionTaskToContract),
    approvals: [],
    outcomes: mission.outcomes,
    createdAt: mission.createdAt,
    updatedAt: mission.updatedAt,
  };
}

export function mapMissionTaskToContract(task: MissionTask): TaskContract {
  return {
    taskId: task.id,
    missionId: task.missionId,
    planId: task.planId,
    agentId: task.agentId,
    agentVersion: task.agentVersion,
    taskType: task.taskType,
    status: task.status,
    input: task.input,
    output: task.output,
    dependsOn: task.dependsOn,
    deadline: task.deadline,
    approvalGateId: task.approvalGateId ?? null,
  };
}
