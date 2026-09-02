export type ApprovalStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'ESCALATED';

export const APPROVAL_STATE_TRANSITIONS: Record<ApprovalStatus, ApprovalStatus[]> = {
  PENDING: ['APPROVED', 'REJECTED', 'EXPIRED', 'ESCALATED'],
  ESCALATED: ['APPROVED', 'REJECTED', 'EXPIRED'],
  APPROVED: [],
  REJECTED: [],
  EXPIRED: [],
};

export function canTransitionApproval(from: ApprovalStatus, to: ApprovalStatus): boolean {
  return APPROVAL_STATE_TRANSITIONS[from].includes(to);
}
