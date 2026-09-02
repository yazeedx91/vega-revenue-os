import { condition, defineQuery, defineSignal, proxyActivities, setHandler } from '@temporalio/workflow';
import type { TenantContext } from '@projectx/domain';
import type {
  MissionWorkflowInput,
  MissionWorkflowStatus,
  MissionControlSignal,
  ApprovalDecisionSignal,
} from '@projectx/mission-orchestrator';
import type * as missionActivities from '@projectx/mission-orchestrator';

const activityOptions = {
  startToCloseTimeout: 120000,
  retry: { maximumAttempts: 3 },
};

type MissionActivities = Pick<
  typeof missionActivities,
  'planMissionActivity' | 'executeMissionStepActivity' | 'checkpointActivity'
>;

const {
  planMissionActivity: planMission,
  executeMissionStepActivity: executeMissionStep,
  checkpointActivity: checkpoint,
} = proxyActivities<MissionActivities>(activityOptions);

export const controlSignal = defineSignal<[MissionControlSignal]>('control');
export const approvalSignal = defineSignal<[ApprovalDecisionSignal]>('approvalDecision');
export const statusQuery = defineQuery<MissionWorkflowStatus | undefined>('status');

const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'ARCHIVED']);

export async function MissionWorkflow(input: MissionWorkflowInput): Promise<void> {
  const ctx: TenantContext = {
    tenantId: input.tenantId,
    correlationId: input.correlationId as string,
  };

  let status: MissionWorkflowStatus = {
    missionId: input.missionId,
    status: 'PLANNING',
  };

  let pendingApproval: ApprovalDecisionSignal | undefined;
  let controlRequest: MissionControlSignal | undefined;

  setHandler(approvalSignal, (decision: ApprovalDecisionSignal) => {
    pendingApproval = decision;
  });

  setHandler(controlSignal, (control: MissionControlSignal) => {
    controlRequest = control;
  });

  setHandler(statusQuery, () => status);

  await planMission(ctx, input.missionId);
  status = { ...status, status: 'EXECUTING' };

  let running = true;
  while (running) {
    if (controlRequest?.action === 'CANCEL') {
      status = { ...status, status: 'CANCELLED' };
      running = false;
      continue;
    }

    if (controlRequest?.action === 'PAUSE') {
      status = { ...status, status: 'PAUSED' };
      controlRequest = undefined;
      await condition(() => controlRequest !== undefined);
      continue;
    }

    if (controlRequest?.action === 'RESUME') {
      status = { ...status, status: 'EXECUTING' };
      controlRequest = undefined;
      continue;
    }

    if (pendingApproval) {
      pendingApproval = undefined;
    }

    await checkpoint(ctx, input.missionId);

    const step = await executeMissionStep(ctx, input.missionId);
    status = { missionId: step.missionId, status: step.status, currentTaskId: step.completedTaskId };

    if (TERMINAL_STATUSES.has(step.status)) {
      running = false;
    }
  }
}
