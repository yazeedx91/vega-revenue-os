/**
 * Task contract.
 * Aligned with docs/technology/18-mission-contract.md.
 */
export interface TaskContract {
  taskId: string;
  missionId: string;
  planId: string;
  agentId: string;
  agentVersion: string;
  taskType: string;
  status: TaskStatus;
  input: unknown;
  output?: unknown;
  dependsOn: string[];
  deadline?: Date;
  approvalGateId: string | null;
}

export type TaskStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'AWAITING_APPROVAL'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'TIMED_OUT';
