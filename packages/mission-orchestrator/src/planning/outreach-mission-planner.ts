import type { IPlanner, PlanningRequest } from '@projectx/ai-runtime';
import type { TenantContext } from '@projectx/domain';
import type { AgentContract } from '@projectx/shared';
import type { PlanContract, PlanPhase, TaskContract } from '@projectx/shared';

const OUTREACH_CHANNELS = new Set(['email', 'linkedin', 'calendar']);
const OUTREACH_OBJECTIVE_PREFIXES = ['outreach', 'sequence', 'campaign', 'prospect'];

export class OutreachMissionPlanner implements IPlanner {
  async plan(ctx: TenantContext, request: PlanningRequest): Promise<PlanContract> {
    const mission = request.mission;
    if (!this.isOutreachMission(mission)) {
      throw new Error('OutreachMissionPlanner can only plan outreach missions');
    }

    const outreachAgent = request.availableAgents.find((a: AgentContract) =>
      a.capabilities.includes('plan-outreach'),
    );
    if (!outreachAgent) {
      throw new Error('No outreach agent available for mission planning');
    }

    const planId = `plan-${mission.missionId}`;

    const phases: PlanPhase[] = [
      {
        phaseId: `${planId}-planning`,
        name: 'Outreach Planning',
        tasks: [
          this.buildTask(
            ctx,
            mission,
            outreachAgent,
            'plan-outreach',
            `${planId}-plan`,
            [],
            {
              mission: mission,
              leadId: (mission.icpId as string) ?? '',
              evidenceIds: [],
            },
          ),
        ],
      },
      {
        phaseId: `${planId}-personalization`,
        name: 'Message Personalization',
        tasks: [
          this.buildTask(
            ctx,
            mission,
            outreachAgent,
            'draft-message',
            `${planId}-draft`,
            [`${planId}-plan`],
            { stepInput: 'plan-output' },
          ),
        ],
      },
      {
        phaseId: `${planId}-execution`,
        name: 'Execution',
        tasks: [
          this.buildTask(
            ctx,
            mission,
            outreachAgent,
            'execute-send',
            `${planId}-send`,
            [`${planId}-draft`],
            { stepInput: 'draft-output' },
            'outreach-approval',
          ),
        ],
        approvalGate: {
          gateId: 'outreach-approval',
          actionType: 'OUTREACH_EMAIL_SEND',
          approverRole: 'mission-owner',
        },
      },
      {
        phaseId: `${planId}-advance`,
        name: 'Sequence Advancement',
        tasks: [
          this.buildTask(
            ctx,
            mission,
            outreachAgent,
            'advance-sequence',
            `${planId}-advance`,
            [`${planId}-send`],
            { stepInput: 'send-output' },
          ),
        ],
      },
    ];

    return {
      planId,
      missionId: mission.missionId,
      version: 1,
      objectives: [
        {
          objectiveId: 'outreach-execution',
          description: 'Execute tenant-isolated outreach sequence with approval gates',
        },
      ],
      phases,
      approvalGates: [
        {
          gateId: 'outreach-approval',
          actionType: 'OUTREACH_EMAIL_SEND',
          approverRole: 'mission-owner',
        },
      ],
      fallbackBranches: [],
    };
  }

  private isOutreachMission(mission: { channels: string[]; objective: string }): boolean {
    const hasChannel = mission.channels.some((c) => OUTREACH_CHANNELS.has(c.toLowerCase()));
    const hasObjective = OUTREACH_OBJECTIVE_PREFIXES.some((p) =>
      mission.objective.toLowerCase().startsWith(p),
    );
    return hasChannel || hasObjective;
  }

  private buildTask(
    _ctx: TenantContext,
    mission: { missionId: string; deadline?: Date },
    agent: AgentContract,
    taskType: string,
    taskId: string,
    dependsOn: string[],
    input: unknown,
    approvalGateId: string | null = null,
  ): TaskContract {
    return {
      taskId,
      missionId: mission.missionId,
      planId: `plan-${mission.missionId}`,
      agentId: agent.agentId,
      agentVersion: agent.version,
      taskType,
      status: 'PENDING',
      input,
      dependsOn,
      deadline: mission.deadline,
      approvalGateId,
    };
  }
}
