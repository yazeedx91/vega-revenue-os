import { asAccountId, asClaimId, asCorrelationId, asEventId, asEvidenceId, asTenantId } from '@projectx/shared';
import { CommercialClaim, ClaimClassification, CommercialClaimInvariantError, ClaimSubjectType } from '../claim';

const tenantId = () => asTenantId('tenant-1');
const corr = () => asCorrelationId('corr-1');
const evt = () => asEventId('evt-1');

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    id: asClaimId('claim-1'),
    tenantId: tenantId(),
    workspaceId: 'ws-1',
    subjectType: 'ACCOUNT' as ClaimSubjectType,
    subjectId: asAccountId('acc-1'),
    classification: 'FACT' as ClaimClassification,
    statement: 'Account has 500 employees',
    evidenceIds: [asEvidenceId('ev-1')],
    confidence: 0.8,
    observedAt: new Date(),
    ...overrides,
  };
}

describe('CommercialClaim', () => {
  describe('creation', () => {
    it('should create valid claim', () => {
      const claim = CommercialClaim.create(baseProps(), corr(), evt());
      expect(claim.id).toBe(asClaimId('claim-1'));
      expect(claim.classification).toBe('FACT');
      expect(claim.statement).toBe('Account has 500 employees');
      expect(claim.confidence).toBe(0.8);
      expect(claim.evidenceIds).toContain(asEvidenceId('ev-1'));
    });

    it('should reject empty workspace ID', () => {
      expect(() => CommercialClaim.create(baseProps({ workspaceId: '' }), corr(), evt())).toThrow(CommercialClaimInvariantError);
      expect(() => CommercialClaim.create(baseProps({ workspaceId: '' }), corr(), evt())).toThrow('Workspace ID is required');
    });

    it('should reject empty statement', () => {
      expect(() => CommercialClaim.create(baseProps({ statement: '' }), corr(), evt())).toThrow(CommercialClaimInvariantError);
      expect(() => CommercialClaim.create(baseProps({ statement: '' }), corr(), evt())).toThrow('Statement is required');
    });

    it('should reject confidence below 0', () => {
      expect(() => CommercialClaim.create(baseProps({ confidence: -0.1 }), corr(), evt())).toThrow(CommercialClaimInvariantError);
      expect(() => CommercialClaim.create(baseProps({ confidence: -0.1 }), corr(), evt())).toThrow('Confidence must be between 0 and 1');
    });

    it('should reject confidence above 1', () => {
      expect(() => CommercialClaim.create(baseProps({ confidence: 1.1 }), corr(), evt())).toThrow(CommercialClaimInvariantError);
      expect(() => CommercialClaim.create(baseProps({ confidence: 1.1 }), corr(), evt())).toThrow('Confidence must be between 0 and 1');
    });

    it('should reject invalid observedAt date', () => {
      expect(() => CommercialClaim.create(baseProps({ observedAt: new Date('invalid') }), corr(), evt())).toThrow(CommercialClaimInvariantError);
      expect(() => CommercialClaim.create(baseProps({ observedAt: new Date('invalid') }), corr(), evt())).toThrow('ObservedAt must be a valid date');
    });

    it('should reject FACT claims without evidence', () => {
      expect(() => CommercialClaim.create(baseProps({ evidenceIds: [] }), corr(), evt())).toThrow(CommercialClaimInvariantError);
      expect(() => CommercialClaim.create(baseProps({ evidenceIds: [] }), corr(), evt())).toThrow('FACT claims require at least one evidence reference');
    });

    it('should allow INFERENCE claims without evidence', () => {
      const claim = CommercialClaim.create(baseProps({ classification: 'INFERENCE' as ClaimClassification, evidenceIds: [] }), corr(), evt());
      expect(claim.classification).toBe('INFERENCE');
      expect(claim.evidenceIds.length).toBe(0);
    });

    it('should allow ASSUMPTION claims without evidence', () => {
      const claim = CommercialClaim.create(baseProps({ classification: 'ASSUMPTION' as ClaimClassification, evidenceIds: [] }), corr(), evt());
      expect(claim.classification).toBe('ASSUMPTION');
      expect(claim.evidenceIds.length).toBe(0);
    });

    it('should generate domain event on creation', () => {
      const claim = CommercialClaim.create(baseProps(), corr(), evt());
      expect(claim.domainEvents.length).toBe(1);
      expect(claim.domainEvents[0].eventType).toBe('ClaimCreated');
    });
  });

  describe('reconstitution', () => {
    it('should reconstitute claim from snapshot', () => {
      const props = baseProps();
      const claim = CommercialClaim.reconstitute(props, 5);
      expect(claim.id).toBe(asClaimId('claim-1'));
      expect(claim.version).toBe(5);
      expect(claim.domainEvents.length).toBe(0);
    });
  });

  describe('updates', () => {
    it('should update classification', () => {
      const claim = CommercialClaim.create(baseProps(), corr(), evt());
      claim.updateClassification('INFERENCE', corr(), evt());
      expect(claim.classification).toBe('INFERENCE');
    });

    it('should update statement', () => {
      const claim = CommercialClaim.create(baseProps(), corr(), evt());
      claim.updateStatement('Updated statement', corr(), evt());
      expect(claim.statement).toBe('Updated statement');
    });

    it('should reject empty statement on update', () => {
      const claim = CommercialClaim.create(baseProps(), corr(), evt());
      expect(() => claim.updateStatement('', corr(), evt())).toThrow(CommercialClaimInvariantError);
    });

    it('should update confidence', () => {
      const claim = CommercialClaim.create(baseProps(), corr(), evt());
      claim.updateConfidence(0.9, corr(), evt());
      expect(claim.confidence).toBe(0.9);
    });

    it('should reject invalid confidence on update', () => {
      const claim = CommercialClaim.create(baseProps(), corr(), evt());
      expect(() => claim.updateConfidence(1.5, corr(), evt())).toThrow(CommercialClaimInvariantError);
    });

    it('should add evidence IDs', () => {
      const claim = CommercialClaim.create(baseProps(), corr(), evt());
      const newEvidenceId = asEvidenceId('ev-2');
      claim.addEvidenceIds([newEvidenceId], corr(), evt());
      expect(claim.evidenceIds).toContain(newEvidenceId);
    });

    it('should retract claim', () => {
      const claim = CommercialClaim.create(baseProps(), corr(), evt());
      claim.retract(corr(), evt());
      expect(claim.domainEvents.length).toBe(2);
      expect(claim.domainEvents[1].eventType).toBe('ClaimRetracted');
    });
  });

  describe('helper methods', () => {
    it('should identify FACT claims', () => {
      const claim = CommercialClaim.create(baseProps({ classification: 'FACT' as ClaimClassification }), corr(), evt());
      expect(claim.isFact()).toBe(true);
      expect(claim.isInference()).toBe(false);
      expect(claim.isAssumption()).toBe(false);
    });

    it('should identify INFERENCE claims', () => {
      const claim = CommercialClaim.create(baseProps({ classification: 'INFERENCE' as ClaimClassification }), corr(), evt());
      expect(claim.isFact()).toBe(false);
      expect(claim.isInference()).toBe(true);
      expect(claim.isAssumption()).toBe(false);
    });

    it('should identify ASSUMPTION claims', () => {
      const claim = CommercialClaim.create(baseProps({ classification: 'ASSUMPTION' as ClaimClassification }), corr(), evt());
      expect(claim.isFact()).toBe(false);
      expect(claim.isInference()).toBe(false);
      expect(claim.isAssumption()).toBe(true);
    });

    it('should identify claims with evidence', () => {
      const claim = CommercialClaim.create(baseProps(), corr(), evt());
      expect(claim.hasEvidence()).toBe(true);
    });

    it('should identify claims without evidence', () => {
      const claim = CommercialClaim.create(baseProps({ classification: 'INFERENCE' as ClaimClassification, evidenceIds: [] }), corr(), evt());
      expect(claim.hasEvidence()).toBe(false);
    });

    it('should identify high confidence claims', () => {
      const claim = CommercialClaim.create(baseProps({ confidence: 0.8 }), corr(), evt());
      expect(claim.isHighConfidence()).toBe(true);
    });

    it('should identify low confidence claims', () => {
      const claim = CommercialClaim.create(baseProps({ confidence: 0.5 }), corr(), evt());
      expect(claim.isHighConfidence()).toBe(false);
    });
  });

  describe('structured fields', () => {
    it('should have explicit subject type', () => {
      const claim = CommercialClaim.create(baseProps({ subjectType: 'FACILITY' as ClaimSubjectType }), corr(), evt());
      expect(claim.subjectType).toBe('FACILITY');
    });

    it('should have explicit subject ID', () => {
      const claim = CommercialClaim.create(baseProps({ subjectId: asAccountId('acc-2') }), corr(), evt());
      expect(claim.subjectId).toBe(asAccountId('acc-2'));
    });

    it('should have explicit reference field', () => {
      const claim = CommercialClaim.create(baseProps({ reference: 'ref-123' }), corr(), evt());
      expect(claim.reference).toBe('ref-123');
    });

    it('should have explicit value field', () => {
      const claim = CommercialClaim.create(baseProps({ value: { employees: 500 } }), corr(), evt());
      expect(claim.value).toEqual({ employees: 500 });
    });

    it('should maintain strong structure without unbounded blobs', () => {
      const claim = CommercialClaim.create(baseProps(), corr(), evt());
      expect(claim.subjectType).toBeDefined();
      expect(claim.statement).toBeDefined();
      expect(claim.classification).toBeDefined();
      expect(claim.confidence).toBeDefined();
      expect(claim.observedAt).toBeDefined();
      // No unbounded businessContext blob
    });
  });

  describe('workspace isolation', () => {
    it('should preserve workspace ID', () => {
      const claim = CommercialClaim.create(baseProps({ workspaceId: 'ws-2' }), corr(), evt());
      expect(claim.workspaceId).toBe('ws-2');
    });

    it('should carry workspace ID through updates', () => {
      const claim = CommercialClaim.create(baseProps({ workspaceId: 'ws-2' }), corr(), evt());
      claim.updateClassification('INFERENCE', corr(), evt());
      expect(claim.workspaceId).toBe('ws-2');
    });
  });

  describe('timestamps', () => {
    it('should set created timestamp on creation', () => {
      const before = new Date();
      const claim = CommercialClaim.create(baseProps(), corr(), evt());
      const after = new Date();
      expect(claim.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(claim.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should update timestamp on updates', () => {
      const claim = CommercialClaim.create(baseProps(), corr(), evt());
      const beforeUpdate = claim.updatedAt;
      claim.updateClassification('INFERENCE', corr(), evt());
      expect(claim.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeUpdate.getTime());
    });
  });
});