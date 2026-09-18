import {
  canTransitionOpportunity,
  isTerminalOpportunityStatus,
  isReversibleOpportunityStatus,
  requiresGuardedTransition,
  requiresJustificationForBackwardTransition,
  type OpportunityStatus,
} from '../opportunity-status';

describe('Opportunity Lifecycle', () => {
  describe('state transitions', () => {
    describe('progression branch', () => {
      it('should allow DISCOVERED to QUALIFYING', () => {
        expect(canTransitionOpportunity('DISCOVERED', 'QUALIFYING')).toBe(true);
      });

      it('should allow QUALIFYING to QUALIFIED', () => {
        expect(canTransitionOpportunity('QUALIFYING', 'QUALIFIED')).toBe(true);
      });

      it('should allow QUALIFIED to DISCOVERY', () => {
        expect(canTransitionOpportunity('QUALIFIED', 'DISCOVERY')).toBe(true);
      });

      it('should allow DISCOVERY to SOLUTION_DESIGN', () => {
        expect(canTransitionOpportunity('DISCOVERY', 'SOLUTION_DESIGN')).toBe(true);
      });

      it('should allow SOLUTION_DESIGN to PROPOSAL', () => {
        expect(canTransitionOpportunity('SOLUTION_DESIGN', 'PROPOSAL')).toBe(true);
      });

      it('should allow PROPOSAL to PILOT', () => {
        expect(canTransitionOpportunity('PROPOSAL', 'PILOT')).toBe(true);
      });

      it('should allow PROPOSAL to NEGOTIATION', () => {
        expect(canTransitionOpportunity('PROPOSAL', 'NEGOTIATION')).toBe(true);
      });

      it('should allow PILOT to NEGOTIATION', () => {
        expect(canTransitionOpportunity('PILOT', 'NEGOTIATION')).toBe(true);
      });
    });

    describe('outcome branches', () => {
      it('should allow NEGOTIATION to WON', () => {
        expect(canTransitionOpportunity('NEGOTIATION', 'WON')).toBe(true);
      });

      it('should allow NEGOTIATION to LOST', () => {
        expect(canTransitionOpportunity('NEGOTIATION', 'LOST')).toBe(true);
      });

      it('should allow DISQUALIFIED from early stages', () => {
        expect(canTransitionOpportunity('DISCOVERED', 'DISQUALIFIED')).toBe(true);
        expect(canTransitionOpportunity('QUALIFYING', 'DISQUALIFIED')).toBe(true);
        expect(canTransitionOpportunity('QUALIFIED', 'DISQUALIFIED')).toBe(true);
        expect(canTransitionOpportunity('DISCOVERY', 'DISQUALIFIED')).toBe(true);
        expect(canTransitionOpportunity('SOLUTION_DESIGN', 'DISQUALIFIED')).toBe(true);
        expect(canTransitionOpportunity('PROPOSAL', 'DISQUALIFIED')).toBe(true);
        expect(canTransitionOpportunity('PILOT', 'DISQUALIFIED')).toBe(true);
        expect(canTransitionOpportunity('NEGOTIATION', 'DISQUALIFIED')).toBe(true);
      });
    });

    describe('backward transitions', () => {
      it('should allow NEGOTIATION to PROPOSAL', () => {
        expect(canTransitionOpportunity('NEGOTIATION', 'PROPOSAL')).toBe(true);
      });

      it('should allow PILOT to SOLUTION_DESIGN', () => {
        expect(canTransitionOpportunity('PILOT', 'SOLUTION_DESIGN')).toBe(true);
      });

      it('should allow SOLUTION_DESIGN to QUALIFIED', () => {
        expect(canTransitionOpportunity('SOLUTION_DESIGN', 'QUALIFIED')).toBe(true);
      });

      it('should allow QUALIFIED to QUALIFYING', () => {
        expect(canTransitionOpportunity('QUALIFIED', 'QUALIFYING')).toBe(true);
      });

      it('should allow DISQUALIFIED to QUALIFYING', () => {
        expect(canTransitionOpportunity('DISQUALIFIED', 'QUALIFYING')).toBe(true);
      });
    });

    describe('invalid transitions', () => {
      it('should not allow DISCOVERED to WON', () => {
        expect(canTransitionOpportunity('DISCOVERED', 'WON')).toBe(false);
      });

      it('should not allow QUALIFIED to WON', () => {
        expect(canTransitionOpportunity('QUALIFIED', 'WON')).toBe(false);
      });

      it('should not allow PROPOSAL to DISCOVERED', () => {
        expect(canTransitionOpportunity('PROPOSAL', 'DISCOVERED')).toBe(false);
      });

      it('should not allow DISQUALIFIED to WON', () => {
        expect(canTransitionOpportunity('DISQUALIFIED', 'WON')).toBe(false);
      });
    });
  });

  describe('terminal states', () => {
    it('should identify WON as terminal', () => {
      expect(isTerminalOpportunityStatus('WON')).toBe(true);
    });

    it('should identify LOST as terminal', () => {
      expect(isTerminalOpportunityStatus('LOST')).toBe(true);
    });

    it('should not identify other states as terminal', () => {
      const nonTerminal: OpportunityStatus[] = [
        'DISCOVERED',
        'QUALIFYING',
        'QUALIFIED',
        'DISCOVERY',
        'SOLUTION_DESIGN',
        'PROPOSAL',
        'PILOT',
        'NEGOTIATION',
        'DISQUALIFIED',
      ];

      nonTerminal.forEach((status) => {
        expect(isTerminalOpportunityStatus(status)).toBe(false);
      });
    });

    it('should not allow transitions from terminal states', () => {
      expect(canTransitionOpportunity('WON', 'QUALIFIED')).toBe(false);
      expect(canTransitionOpportunity('WON', 'DISQUALIFIED')).toBe(false);
      expect(canTransitionOpportunity('LOST', 'QUALIFIED')).toBe(false);
      expect(canTransitionOpportunity('LOST', 'DISQUALIFIED')).toBe(false);
    });
  });

  describe('reversible states', () => {
    it('should identify DISQUALIFIED as reversible', () => {
      expect(isReversibleOpportunityStatus('DISQUALIFIED')).toBe(true);
    });

    it('should not identify other states as reversible', () => {
      const nonReversible: OpportunityStatus[] = [
        'DISCOVERED',
        'QUALIFYING',
        'QUALIFIED',
        'DISCOVERY',
        'SOLUTION_DESIGN',
        'PROPOSAL',
        'PILOT',
        'NEGOTIATION',
        'WON',
        'LOST',
      ];

      nonReversible.forEach((status) => {
        expect(isReversibleOpportunityStatus(status)).toBe(false);
      });
    });
  });

  describe('guarded transitions', () => {
    it('should require guarded transition for DISQUALIFIED to QUALIFYING', () => {
      expect(requiresGuardedTransition('DISQUALIFIED', 'QUALIFYING')).toBe(true);
    });

    it('should not require guarded transition for other moves', () => {
      expect(requiresGuardedTransition('QUALIFIED', 'DISCOVERY')).toBe(false);
      expect(requiresGuardedTransition('NEGOTIATION', 'WON')).toBe(false);
      expect(requiresGuardedTransition('DISCOVERED', 'QUALIFYING')).toBe(false);
    });
  });

  describe('justification for backward transitions', () => {
    it('should require justification for NEGOTIATION to PROPOSAL', () => {
      expect(requiresJustificationForBackwardTransition('NEGOTIATION', 'PROPOSAL')).toBe(true);
    });

    it('should require justification for PILOT to SOLUTION_DESIGN', () => {
      expect(requiresJustificationForBackwardTransition('PILOT', 'SOLUTION_DESIGN')).toBe(true);
    });

    it('should require justification for SOLUTION_DESIGN to QUALIFIED', () => {
      expect(requiresJustificationForBackwardTransition('SOLUTION_DESIGN', 'QUALIFIED')).toBe(true);
    });

    it('should require justification for QUALIFIED to QUALIFYING', () => {
      expect(requiresJustificationForBackwardTransition('QUALIFIED', 'QUALIFYING')).toBe(true);
    });

    it('should require justification for DISQUALIFIED to QUALIFYING', () => {
      expect(requiresJustificationForBackwardTransition('DISQUALIFIED', 'QUALIFYING')).toBe(true);
    });

    it('should not require justification for forward transitions', () => {
      expect(requiresJustificationForBackwardTransition('DISCOVERED', 'QUALIFYING')).toBe(false);
      expect(requiresJustificationForBackwardTransition('QUALIFIED', 'DISCOVERY')).toBe(false);
      expect(requiresJustificationForBackwardTransition('NEGOTIATION', 'WON')).toBe(false);
    });
  });

  describe('branching state graph structure', () => {
    it('should represent lifecycle as branching graph, not linear chain', () => {
      // Progression branch exists
      expect(canTransitionOpportunity('DISCOVERED', 'QUALIFYING')).toBe(true);
      expect(canTransitionOpportunity('QUALIFYING', 'QUALIFIED')).toBe(true);
      expect(canTransitionOpportunity('QUALIFIED', 'DISCOVERY')).toBe(true);

      // Outcome branches exist
      expect(canTransitionOpportunity('NEGOTIATION', 'WON')).toBe(true);
      expect(canTransitionOpportunity('NEGOTIATION', 'LOST')).toBe(true);
      expect(canTransitionOpportunity('DISCOVERED', 'DISQUALIFIED')).toBe(true);

      // Backward transitions exist
      expect(canTransitionOpportunity('NEGOTIATION', 'PROPOSAL')).toBe(true);
      expect(canTransitionOpportunity('QUALIFIED', 'QUALIFYING')).toBe(true);
    });

    it('should have multiple paths to DISQUALIFIED', () => {
      expect(canTransitionOpportunity('DISCOVERED', 'DISQUALIFIED')).toBe(true);
      expect(canTransitionOpportunity('QUALIFYING', 'DISQUALIFIED')).toBe(true);
      expect(canTransitionOpportunity('QUALIFIED', 'DISQUALIFIED')).toBe(true);
      expect(canTransitionOpportunity('DISCOVERY', 'DISQUALIFIED')).toBe(true);
      expect(canTransitionOpportunity('SOLUTION_DESIGN', 'DISQUALIFIED')).toBe(true);
      expect(canTransitionOpportunity('PROPOSAL', 'DISQUALIFIED')).toBe(true);
      expect(canTransitionOpportunity('PILOT', 'DISQUALIFIED')).toBe(true);
      expect(canTransitionOpportunity('NEGOTIATION', 'DISQUALIFIED')).toBe(true);
    });

    it('should have single terminal outcome path', () => {
      // WON and LOST are terminal - no transitions out
      expect(canTransitionOpportunity('WON', 'DISCOVERED')).toBe(false);
      expect(canTransitionOpportunity('WON', 'QUALIFIED')).toBe(false);
      expect(canTransitionOpportunity('LOST', 'DISCOVERED')).toBe(false);
      expect(canTransitionOpportunity('LOST', 'QUALIFIED')).toBe(false);
    });
  });
});