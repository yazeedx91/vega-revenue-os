import { ValidationError } from '@projectx/shared';
import type { TenantContext } from '@projectx/domain';
import type {
  AgentContract,
  MissionContract,
  PlanContract,
  PlanPhase,
  TaskContract,
  TaskStatus,
} from '@projectx/shared';
import type { IPlanner, PlanningRequest } from './planner.interface';

export interface MissionPlannerConfig {
  readonly phaseTemplates: PhaseTemplate[];
}

export interface PhaseTemplate {
  readonly phaseId: string;
  readonly name: string;
  readonly capability: string;
  readonly requiredWhen: (mission: MissionContract) => boolean;
  readonly dependencies: string[];
  readonly taskType: string;
}

export class PlannerError extends ValidationError {
  constructor(message: string) {
    super(`Planner: ${message}`);
  }
}

export class MissionPlanner implements IPlanner {
  constructor(private readonly config: MissionPlannerConfig) {}

  async plan(ctx: TenantContext, request: PlanningRequest): Promise<PlanContract> {
    if (request.mission.tenantId !== ctx.tenantId) {
      throw new PlannerError('Mission tenant does not match execution context');
    }

    const selectedPhases = this.config.phaseTemplates.filter((template) =>
      template.requiredWhen(request.mission),
    );

    if (selectedPhases.length === 0) {
      throw new PlannerError('No applicable phase templates for the mission');
    }

    const availableCapabilities = new Set(
      request.availableAgents.flatMap((agent) => agent.capabilities),
    );

    const missingCapabilities = selectedPhases
      .map((phase) => phase.capability)
      .filter((cap) => !availableCapabilities.has(cap));

    if (missingCapabilities.length > 0) {
      throw new PlannerError(
        `Missing required capabilities: ${[...new Set(missingCapabilities)].join(', ')}`,
      );
    }

    const phases: PlanPhase[] = [];
    const taskStatus: TaskStatus = 'PENDING';

    for (const template of selectedPhases) {
      const agent = this.selectAgent(request.availableAgents, template.capability);
      if (!agent) {
        throw new PlannerError(`No agent provides capability ${template.capability}`);
      }

      const taskId = `${request.mission.missionId}-${template.phaseId}-task`;
      const task: TaskContract = {
        taskId,
        missionId: request.mission.missionId,
        planId: `${request.mission.missionId}-plan`,
        agentId: agent.agentId,
        agentVersion: agent.version,
        taskType: template.taskType,
        status: taskStatus,
        input: { objective: request.mission.objective, channel: template.phaseId },
        dependsOn: template.dependencies.map(
          (depPhaseId) => `${request.mission.missionId}-${depPhaseId}-task`,
        ),
        approvalGateId: null,
      };

      const phase: PlanPhase = {
        phaseId: `${request.mission.missionId}-${template.phaseId}`,
        name: template.name,
        tasks: [task],
      };

      phases.push(phase);
    }

    return {
      planId: `${request.mission.missionId}-plan`,
      missionId: request.mission.missionId,
      version: 1,
      objectives: [request.mission.objective],
      phases,
      approvalGates: [],
      fallbackBranches: [],
    };
  }

  private selectAgent(agents: AgentContract[], capability: string): AgentContract | undefined {
    return agents.find((agent) => agent.capabilities.includes(capability));
  }
}
