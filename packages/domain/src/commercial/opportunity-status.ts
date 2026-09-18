export type OpportunityStatus =
  | 'DISCOVERED'
  | 'QUALIFYING'
  | 'QUALIFIED'
  | 'DISCOVERY'
  | 'SOLUTION_DESIGN'
  | 'PROPOSAL'
  | 'PILOT'
  | 'NEGOTIATION'
  | 'WON'
  | 'LOST'
  | 'DISQUALIFIED';

// Branching state graph - not a linear chain
// Progression branch: forward movement through opportunity stages
// Outcome branches: alternative terminal/non-terminal outcomes
export const OPPORTUNITY_STATE_TRANSITIONS: Record<OpportunityStatus, OpportunityStatus[]> = {
  // Progression branch (forward movement)
  DISCOVERED: ['QUALIFYING', 'DISQUALIFIED'],
  QUALIFYING: ['QUALIFIED', 'DISQUALIFIED'],
  QUALIFIED: ['DISCOVERY', 'QUALIFYING', 'DISQUALIFIED'],
  DISCOVERY: ['SOLUTION_DESIGN', 'QUALIFIED', 'DISQUALIFIED'],
  SOLUTION_DESIGN: ['PROPOSAL', 'QUALIFIED', 'DISQUALIFIED'],
  PROPOSAL: ['PILOT', 'NEGOTIATION', 'SOLUTION_DESIGN', 'DISQUALIFIED'],
  PILOT: ['NEGOTIATION', 'SOLUTION_DESIGN', 'DISQUALIFIED'],
  NEGOTIATION: ['WON', 'LOST', 'PROPOSAL', 'DISQUALIFIED'],
  
  // Terminal states (cannot transition out)
  WON: [],
  LOST: [],
  
  // Reversible non-terminal state (requires guarded transition)
  DISQUALIFIED: ['QUALIFYING'],
};

const backwardTransitions: Record<OpportunityStatus, OpportunityStatus[]> = {
  DISCOVERED: [],
  QUALIFYING: [],
  QUALIFIED: ['QUALIFYING'],
  DISCOVERY: [],
  SOLUTION_DESIGN: ['QUALIFIED'],
  PROPOSAL: [],
  PILOT: ['SOLUTION_DESIGN'],
  NEGOTIATION: ['PROPOSAL'],
  WON: [],
  LOST: [],
  DISQUALIFIED: ['QUALIFYING'],
};

export function canTransitionOpportunity(from: OpportunityStatus, to: OpportunityStatus): boolean {
  return OPPORTUNITY_STATE_TRANSITIONS[from].includes(to);
}

export function isTerminalOpportunityStatus(status: OpportunityStatus): boolean {
  return status === 'WON' || status === 'LOST';
}

export function isReversibleOpportunityStatus(status: OpportunityStatus): boolean {
  return status === 'DISQUALIFIED';
}

export function requiresGuardedTransition(from: OpportunityStatus, to: OpportunityStatus): boolean {
  return from === 'DISQUALIFIED' && to === 'QUALIFYING';
}

export function requiresJustificationForBackwardTransition(from: OpportunityStatus, to: OpportunityStatus): boolean {
  return backwardTransitions[from]?.includes(to) ?? false;
}