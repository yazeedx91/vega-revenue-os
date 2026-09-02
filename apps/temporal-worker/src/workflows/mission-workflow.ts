import { defineQuery, defineSignal, proxyActivities, setHandler } from '@temporalio/workflow';
import type { TenantContext } from '@projectx/domain';
import type { AIExecutionResult } from '@projectx/shared';
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
  | 'planMissionActivity'
  | 'executeTaskActivity'
  | 'handleTaskResultActivity'
  | 'evaluateCompletionActivity'
  | 'checkpointActivity'
>;

const {
  planMissionActivity: planMission,
  executeTaskActivity: executeTask,
  handleTaskResultActivity: handleTaskResult,
  evaluateCompletionActivity: evaluateCompletion,
  checkpointActivity: checkpoint,
} = proxyActivities<MissionActivities>(activityOptions);

export const controlSignal = defineSignal<[MissionControlSignal]>('control');
export const approvalSignal = defineSignal<[ApprovalDecisionSignal]>('approvalDecision');
export const statusQuery = defineQuery<MissionWorkflowStatus | undefined>('status');

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
      break;
    }

    if (controlRequest?.action === 'PAUSE') {
      status = { ...status, status: 'PAUSED' };
      controlRequest = undefined;
      continue;
    }

    if (controlRequest?.action === 'RESUME') {
      status = { ...status, status: 'EXECUTING' };
      controlRequest = undefined;
    }

    if (pendingApproval) {
      pendingApproval = undefined;
    }

    await checkpoint(ctx, { id: input.missionId, tenantId: input.tenantId } as never);

    // Placeholder step: the full implementation will select the next runnable
    // task from the mission aggregate and loop until the mission is terminal.
    const result: AIExecutionResult = (await executeTask(
      ctx,
      { id: input.missionId, tenantId: input.tenantId } as never,
      { id: `${input.missionId}-task` } as never,
    )) as AIExecutionResult;

    await handleTaskResult(
      ctx,
      { id: input.missionId, tenantId: input.tenantId } as never,
      { id: `${input.missionId}-task` } as never,
      result,
    );

    await evaluateCompletion(ctx, {
      id: input.missionId,
      tenantId: input.tenantId,
    } as never);

    status = { ...status, status: 'COMPLETED' };
    running = false;
  }
}
