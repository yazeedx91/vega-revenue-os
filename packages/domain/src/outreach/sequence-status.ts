export type SequenceStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'RUNNING'
  | 'WAITING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED';

export const SEQUENCE_STATE_TRANSITIONS: Record<SequenceStatus, SequenceStatus[]> = {
  DRAFT: ['PENDING_APPROVAL', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'CANCELLED'],
  APPROVED: ['RUNNING', 'CANCELLED'],
  RUNNING: ['WAITING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED'],
  WAITING: ['RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED'],
  PAUSED: ['RUNNING', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  FAILED: [],
};

export function canTransitionSequence(from: SequenceStatus, to: SequenceStatus): boolean {
  return SEQUENCE_STATE_TRANSITIONS[from].includes(to);
}
