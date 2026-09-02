import type { AIExecutionResult } from '@projectx/shared';

export interface StartMissionCommand {
  missionId: string;
}

export interface PauseMissionCommand {
  missionId: string;
  reason: string;
}

export interface ResumeMissionCommand {
  missionId: string;
}

export interface CancelMissionCommand {
  missionId: string;
  reason: string;
}

export interface SubmitApprovalDecisionCommand {
  approvalId: string;
  decision: 'APPROVED' | 'REJECTED';
  reason: string;
  actorId: string;
}

export interface TimeoutApprovalCommand {
  approvalId: string;
}

export interface AgentExecutionCompletedEvent {
  executionId: string;
  missionId: string;
  taskId: string;
  result: AIExecutionResult;
}

export interface AgentExecutionFailedEvent {
  executionId: string;
  missionId: string;
  taskId: string;
  result: AIExecutionResult;
}

export interface AgentExecutionAwaitingApprovalEvent {
  executionId: string;
  missionId: string;
  taskId: string;
  result: AIExecutionResult;
}
