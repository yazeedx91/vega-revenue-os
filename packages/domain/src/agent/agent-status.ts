export type AgentLifecycle =
  | 'DRAFT'
  | 'TESTING'
  | 'APPROVED'
  | 'ACTIVE'
  | 'DEPRECATED'
  | 'RETIRED';

export const ACTIVE_STATUSES: AgentLifecycle[] = ['APPROVED', 'ACTIVE'];
