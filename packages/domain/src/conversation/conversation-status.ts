export type ConversationStatus =
  | 'PENDING'
  | 'AWAITING_REPLY'
  | 'CLASSIFIED'
  | 'FOLLOW_UP_SCHEDULED'
  | 'ESCALATED'
  | 'DISQUALIFIED'
  | 'OPTED_OUT'
  | 'CLOSED'
  | 'FAILED';

export const CONVERSATION_STATE_TRANSITIONS: Record<ConversationStatus, ConversationStatus[]> = {
  PENDING: ['AWAITING_REPLY', 'CLASSIFIED', 'OPTED_OUT', 'FAILED'],
  AWAITING_REPLY: ['CLASSIFIED', 'OPTED_OUT', 'FAILED'],
  CLASSIFIED: ['CLASSIFIED', 'FOLLOW_UP_SCHEDULED', 'ESCALATED', 'DISQUALIFIED', 'OPTED_OUT', 'CLOSED'],
  FOLLOW_UP_SCHEDULED: ['AWAITING_REPLY', 'ESCALATED', 'CLOSED', 'FAILED'],
  ESCALATED: ['CLOSED', 'FAILED'],
  DISQUALIFIED: [],
  OPTED_OUT: [],
  CLOSED: [],
  FAILED: [],
};

export function canTransitionConversation(from: ConversationStatus, to: ConversationStatus): boolean {
  return CONVERSATION_STATE_TRANSITIONS[from].includes(to);
}
