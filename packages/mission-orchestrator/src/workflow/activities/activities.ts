import type { TenantContext } from '@projectx/domain';
import type { AIExecutionResult } from '@projectx/shared';
import type { Mission, MissionTask } from '@projectx/domain';
import type { MissionExecutionEngine } from '../mission-execution-engine';

let engineContext: MissionExecutionEngine | null = null;

export function setActivityEngineContext(engine: MissionExecutionEngine): void {
  engineContext = engine;
}

function getEngine(): MissionExecutionEngine {
  if (!engineContext) {
    throw new Error('Activity engine context has not been set');
  }
  return engineContext;
}

export async function planMissionActivity(ctx: TenantContext, missionId: string): Promise<void> {
  return getEngine().planMission(ctx, missionId);
}

export async function executeTaskActivity(
  ctx: TenantContext,
  mission: Mission,
  task: MissionTask,
): Promise<AIExecutionResult> {
  return getEngine().runTask(ctx, mission, task);
}

export async function evaluateCompletionActivity(ctx: TenantContext, mission: Mission): Promise<void> {
  return getEngine().evaluateCompletion(ctx, mission);
}

export async function handleTaskResultActivity(
  ctx: TenantContext,
  mission: Mission,
  task: MissionTask,
  result: AIExecutionResult,
): Promise<void> {
  return getEngine().handleTaskResult(ctx, mission, task, result);
}

export async function compensateActivity(
  ctx: TenantContext,
  mission: Mission,
  task: MissionTask,
  result: AIExecutionResult,
): Promise<void> {
  return getEngine()['compensateIfNeeded'](ctx, mission, task, result);
}

export async function checkpointActivity(_ctx: TenantContext, _mission: Mission): Promise<void> {
  // The engine already persists after every significant step.
  // This activity is a durable no-op hook for workflow checkpoints.
}
