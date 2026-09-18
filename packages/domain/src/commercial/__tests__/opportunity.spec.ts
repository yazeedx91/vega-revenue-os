import { asAccountId, asClaimId, asContactId, asCorrelationId, asEventId, asEvidenceId, asFacilityId, asOpportunityId, asTenantId } from '@projectx/shared';
import { MonetaryAmount } from '../value-objects/monetary-amount';
import { Probability } from '../value-objects/probability';
import { Opportunity, OpportunityInvariantError } from '../opportunity';

const tenantId = () => asTenantId('tenant-1');
const corr = () => asCorrelationId('corr-1');
const evt = () => asEventId('evt-1');

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    id: asOpportunityId('opp-1'),
    tenantId: tenantId(),
    workspaceId: 'ws-1',
    accountId: asAccountId('acc-1'),
    ...overrides,
  };
}

describe('Opportunity', () => {
  describe('creation', () => {
    it('should create valid opportunity', () => {
      const opportunity = Opportunity.create(baseProps(), corr(), evt());
      expect(opportunity.id).toBe(asOpportunityId('opp-1'));
      expect(opportunity.accountId).toBe(asAccountId('acc-1'));
      expect(opportunity.stage).toBe('DISCOVERED');
      expect(opportunity.isActive()).toBe(true);
    });

    it('should reject empty workspace ID', () => {
      expect(() => Opportunity.create(baseProps({ workspaceId: '' }), corr(), evt())).toThrow(OpportunityInvariantError);
      expect(() => Opportunity.create(baseProps({ workspaceId: '' }), corr(), evt())).toThrow('Workspace ID is required');
    });

    it('should reject invalid technical readiness', () => {
      expect(() => Opportunity.create(baseProps({ technicalReadiness: 1.5 }), corr(), evt())).toThrow(OpportunityInvariantError);
      expect(() => Opportunity.create(baseProps({ technicalReadiness: 1.5 }), corr(), evt())).toThrow('Technical readiness must be between 0 and 1');
    });

    it('should reject invalid commercial readiness', () => {
      expect(() => Opportunity.create(baseProps({ commercialReadiness: -0.1 }), corr(), evt())).toThrow(OpportunityInvariantError);
      expect(() => Opportunity.create(baseProps({ commercialReadiness: -0.1 }), corr(), evt())).toThrow('Commercial readiness must be between 0 and 1');
    });

    it('should set default stage to DISCOVERED', () => {
      const opportunity = Opportunity.create(baseProps(), corr(), evt());
      expect(opportunity.stage).toBe('DISCOVERED');
    });

    it('should accept custom stage', () => {
      const opportunity = Opportunity.create(baseProps({ stage: 'QUALIFIED' }), corr(), evt());
      expect(opportunity.stage).toBe('QUALIFIED');
    });

    it('should accept previous opportunity ID', () => {
      const opportunity = Opportunity.create(baseProps({ previousOpportunityId: asOpportunityId('opp-0') }), corr(), evt());
      expect(opportunity.previousOpportunityId).toBe(asOpportunityId('opp-0'));
      expect(opportunity.hasPreviousOpportunity()).toBe(true);
    });

    it('should generate domain event on creation', () => {
      const opportunity = Opportunity.create(baseProps(), corr(), evt());
      expect(opportunity.domainEvents.length).toBe(1);
      expect(opportunity.domainEvents[0].eventType).toBe('OpportunityDiscovered');
    });
  });

  describe('reconstitution', () => {
    it('should reconstitute opportunity from snapshot', () => {
      const props = baseProps({ stage: 'QUALIFIED' });
      const opportunity = Opportunity.reconstitute(props, 5);
      expect(opportunity.id).toBe(asOpportunityId('opp-1'));
      expect(opportunity.version).toBe(5);
      expect(opportunity.domainEvents.length).toBe(0);
    });
  });

  describe('state transitions', () => {
    it('should transition to QUALIFYING', () => {
      const opportunity = Opportunity.create(baseProps(), corr(), evt());
      opportunity.qualify(corr(), evt());
      expect(opportunity.stage).toBe('QUALIFYING');
    });

    it('should transition to QUALIFIED from QUALIFYING', () => {
      const opportunity = Opportunity.create(baseProps(), corr(), evt());
      opportunity.qualify(corr(), evt());
      opportunity.advanceToQualified(corr(), evt());
      expect(opportunity.stage).toBe('QUALIFIED');
    });

    it('should disqualify with reason', () => {
      const opportunity = Opportunity.create(baseProps(), corr(), evt());
      opportunity.disqualify('Not a good fit', corr(), evt());
      expect(opportunity.stage).toBe('DISQUALIFIED');
      expect(opportunity.isDisqualified()).toBe(true);
    });

    it('should reconsider from DISQUALIFIED with justification', () => {
      const opportunity = Opportunity.create(baseProps(), corr(), evt());
      opportunity.disqualify('Not a good fit', corr(), evt());
      opportunity.reconsider('New evidence available', corr(), evt());
      expect(opportunity.stage).toBe('QUALIFYING');
    });

    it('should reject reconsider without justification', () => {
      const opportunity = Opportunity.create(baseProps(), corr(), evt());
      opportunity.disqualify('Not a good fit', corr(), evt());
      expect(() => opportunity.reconsider('', corr(), evt())).toThrow(OpportunityInvariantError);
      expect(() => opportunity.reconsider('', corr(), evt())).toThrow('Guarded transition requires justification');
    });

    it('should win opportunity', () => {
      const opportunity = Opportunity.create(baseProps({ stage: 'NEGOTIATION' }), corr(), evt());
      opportunity.win(corr(), evt());
      expect(opportunity.stage).toBe('WON');
      expect(opportunity.isWon()).toBe(true);
      expect(opportunity.isTerminal()).toBe(true);
    });

    it('should lose opportunity with reason', () => {
      const opportunity = Opportunity.create(baseProps({ stage: 'NEGOTIATION' }), corr(), evt());
      opportunity.lose('Competitor chosen', corr(), evt());
      expect(opportunity.stage).toBe('LOST');
      expect(opportunity.isLost()).toBe(true);
      expect(opportunity.isTerminal()).toBe(true);
    });

    it('should reject transition from terminal state', () => {
      const opportunity = Opportunity.create(baseProps({ stage: 'WON' }), corr(), evt());
      expect(() => opportunity.qualify(corr(), evt())).toThrow(OpportunityInvariantError);
      expect(() => opportunity.qualify(corr(), evt())).toThrow('Cannot transition from terminal state');
    });

    it('should reject invalid state transition', () => {
      const opportunity = Opportunity.create(baseProps(), corr(), evt());
      expect(() => opportunity.transitionTo('WON', corr(), evt())).toThrow(OpportunityInvariantError);
      expect(() => opportunity.transitionTo('WON', corr(), evt())).toThrow('Cannot transition opportunity');
    });

    it('should require justification for backward transition', () => {
      const opportunity = Opportunity.create(baseProps({ stage: 'QUALIFIED' }), corr(), evt());
      expect(() => opportunity.transitionTo('QUALIFYING', corr(), evt())).toThrow(OpportunityInvariantError);
      expect(() => opportunity.transitionTo('QUALIFYING', corr(), evt())).toThrow('Backward transition requires justification');
    });

    it('should allow backward transition with justification', () => {
      const opportunity = Opportunity.create(baseProps({ stage: 'QUALIFIED' }), corr(), evt());
      opportunity.transitionTo('QUALIFYING', corr(), evt(), 'New information');
      expect(opportunity.stage).toBe('QUALIFYING');
    });
  });

  describe('updates', () => {
    it('should update problem hypothesis', () => {
      const opportunity = Opportunity.create(baseProps(), corr(), evt());
      opportunity.updateProblemHypothesis('Customer has maintenance issues', corr(), evt());
      expect(opportunity.problemHypothesis).toBe('Customer has maintenance issues');
    });

    it('should update solution fit', () => {
      const opportunity = Opportunity.create(baseProps(), corr(), evt());
      opportunity.updateSolutionFit('Vega predictive maintenance fits well', corr(), evt());
      expect(opportunity.vegaSolutionFit).toBe('Vega predictive maintenance fits well');
    });

    it('should update win probability', () => {
      const opportunity = Opportunity.create(baseProps(), corr(), evt());
      const probability = Probability.create(0.75);
      opportunity.updateWinProbability(probability, corr(), evt());
      expect(opportunity.winProbability).toEqual(probability);
    });

    it('should set next action', () => {
      const opportunity = Opportunity.create(baseProps(), corr(), evt());
      opportunity.setNextAction('Schedule discovery call', corr(), evt());
      expect(opportunity.nextAction).toBe('Schedule discovery call');
    });
  });

  describe('associations', () => {
    it('should add facility', () => {
      const opportunity = Opportunity.create(baseProps(), corr(), evt());
      const facilityId = asFacilityId('fac-1');
      opportunity.addFacility(facilityId, corr(), evt());
      expect(opportunity.facilityIds).toContain(facilityId);
    });

    it('should not duplicate facility', () => {
      const opportunity = Opportunity.create(baseProps(), corr(), evt());
      const facilityId = asFacilityId('fac-1');
      opportunity.addFacility(facilityId, corr(), evt());
      opportunity.addFacility(facilityId, corr(), evt());
      expect(opportunity.facilityIds.filter((id) => id === facilityId).length).toBe(1);
    });

    it('should add contact', () => {
      const opportunity = Opportunity.create(baseProps(), corr(), evt());
      const contactId = asContactId('contact-1');
      opportunity.addContact(contactId, corr(), evt());
      expect(opportunity.contactIds).toContain(contactId);
    });

    it('should add evidence', () => {
      const opportunity = Opportunity.create(baseProps(), corr(), evt());
      const evidenceId = asEvidenceId('ev-1');
      opportunity.addEvidence(evidenceId, corr(), evt());
      expect(opportunity.evidenceIds).toContain(evidenceId);
    });

    it('should add claim', () => {
      const opportunity = Opportunity.create(baseProps(), corr(), evt());
      const claimId = asClaimId('claim-1');
      opportunity.addClaim(claimId, corr(), evt());
      expect(opportunity.claimIds).toContain(claimId);
    });
  });

  describe('monetary values', () => {
    it('should accept estimated ACV', () => {
      const acv = MonetaryAmount.create(100000, 'USD');
      const opportunity = Opportunity.create(baseProps({ estimatedACV: acv }), corr(), evt());
      expect(opportunity.estimatedACV).toEqual(acv);
    });

    it('should accept expected ARR', () => {
      const arr = MonetaryAmount.create(120000, 'USD');
      const opportunity = Opportunity.create(baseProps({ expectedARR: arr }), corr(), evt());
      expect(opportunity.expectedARR).toEqual(arr);
    });

    it('should accept expansion potential', () => {
      const expansion = MonetaryAmount.create(50000, 'USD');
      const opportunity = Opportunity.create(baseProps({ expansionPotential: expansion }), corr(), evt());
      expect(opportunity.expansionPotential).toEqual(expansion);
    });
  });

  describe('workspace isolation', () => {
    it('should preserve workspace ID', () => {
      const opportunity = Opportunity.create(baseProps({ workspaceId: 'ws-2' }), corr(), evt());
      expect(opportunity.workspaceId).toBe('ws-2');
    });

    it('should carry workspace ID through updates', () => {
      const opportunity = Opportunity.create(baseProps({ workspaceId: 'ws-2' }), corr(), evt());
      opportunity.updateProblemHypothesis('Updated', corr(), evt());
      expect(opportunity.workspaceId).toBe('ws-2');
    });
  });

  describe('timestamps', () => {
    it('should set created timestamp on creation', () => {
      const before = new Date();
      const opportunity = Opportunity.create(baseProps(), corr(), evt());
      const after = new Date();
      expect(opportunity.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(opportunity.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should update timestamp on updates', () => {
      const opportunity = Opportunity.create(baseProps(), corr(), evt());
      const beforeUpdate = opportunity.updatedAt;
      opportunity.updateProblemHypothesis('Updated', corr(), evt());
      expect(opportunity.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeUpdate.getTime());
    });
  });

  describe('previous opportunity linking', () => {
    it('should link to previous opportunity', () => {
      const opportunity = Opportunity.create(baseProps({ previousOpportunityId: asOpportunityId('opp-0') }), corr(), evt());
      expect(opportunity.hasPreviousOpportunity()).toBe(true);
      expect(opportunity.previousOpportunityId).toBe(asOpportunityId('opp-0'));
    });

    it('should not have previous opportunity by default', () => {
      const opportunity = Opportunity.create(baseProps(), corr(), evt());
      expect(opportunity.hasPreviousOpportunity()).toBe(false);
      expect(opportunity.previousOpportunityId).toBeNull();
    });
  });
});