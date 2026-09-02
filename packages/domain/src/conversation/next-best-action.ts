export type NextActionType =
  | 'FOLLOW_UP'
  | 'ESCALATE'
  | 'DISQUALIFY'
  | 'SCHEDULE_MEETING_DEFERRED'
  | 'CLOSE';

export interface NextBestAction {
  readonly actionType: NextActionType;
  readonly reason: string;
  readonly requiresApproval: boolean;
  readonly suggestedFollowUp?: string;
}
