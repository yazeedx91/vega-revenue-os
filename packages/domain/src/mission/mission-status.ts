export type MissionStatus =
  | 'DRAFT'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'PLANNING'
  | 'EXECUTING'
  | 'PAUSED'
  | 'AWAITING_APPROVAL'
  | 'BLOCKED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'ARCHIVED';

export const MISSION_STATE_TRANSITIONS: Record<MissionStatus, MissionStatus[]> = {
  DRAFT: ['APPROVED', 'CANCELLED'],
  APPROVED: ['SCHEDULED', 'PLANNING'],
  SCHEDULED: ['PLANNING'],
  PLANNING: ['EXECUTING'],
  EXECUTING: ['PAUSED', 'AWAITING_APPROVAL', 'BLOCKED', 'COMPLETED', 'FAILED', 'CANCELLED'],
  PAUSED: ['EXECUTING', 'CANCELLED'],
  AWAITING_APPROVAL: ['EXECUTING', 'CANCELLED'],
  BLOCKED: ['EXECUTING', 'FAILED'],
  COMPLETED: ['ARCHIVED'],
  FAILED: ['ARCHIVED'],
  CANCELLED: ['ARCHIVED'],
  ARCHIVED: [],
};

export function canTransitionMission(from: MissionStatus, to: MissionStatus): boolean {
  return MISSION_STATE_TRANSITIONS[from].includes(to);
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

export const TASK_STATE_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  PENDING: ['RUNNING', 'CANCELLED'],
  RUNNING: ['AWAITING_APPROVAL', 'PAUSED', 'COMPLETED', 'FAILED', 'TIMED_OUT'],
  AWAITING_APPROVAL: ['RUNNING', 'CANCELLED'],
  PAUSED: ['RUNNING', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
  TIMED_OUT: [],
};

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_STATE_TRANSITIONS[from].includes(to);
}

export interface MissionOutcomes {
  meetingsBooked?: number;
  opportunitiesCreated?: number;
}
