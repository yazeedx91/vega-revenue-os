import {
  asAccountId, asContactId, asCorrelationId, asEventId,
  asEvidenceId, asICPProfileId, asICPProfileVersionId,
  asLeadId, asSignalId, asTenantId,
} from '@projectx/shared';
import { Lead, LeadInvariantError } from '../intelligence';
import type { EvaluationInput } from '../intelligence/lead';

const tenantId = () => asTenantId('tenant-1');
const corr = () => asCorrelationId('corr-1');
const evt = () => asEventId('evt-1');

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    id: asLeadId('lead-1'),
    tenantId: tenantId(),
    workspaceId: 'ws-1',
    accountId: asAccountId('acc-1'),
    contactId: asContactId('con-1'),
    icpProfileId: asICPProfileId('icp-1'),
    icpProfileVersionId: asICPProfileVersionId('icp-1-v1'),
    ...overrides,
  };
}

function baseInput(overrides: Partial<EvaluationInput> = {}): EvaluationInput {
  return {
    scores: { icpMatch: 0.9, signalScore: 0.8, intentScore: 0.85, evidenceConfidence: 0.9, overall: 0.85 },
    qualificationThreshold: 0.75,
    reviewThreshold: 0.55,
    hardFilterResults: [],
    evidenceIds: [asEvidenceId('ev-1')],
    signalIds: [asSignalId('sig-1')],
    normalizedFeatures: { industry: 'Manufacturing', employeeCount: 500 },
    snapshotSchemaVersion: '1.0',
    scoringPolicyVersion: '1.0',
    algorithmVersion: '1.0',
    evaluatedAt: new Date('2026-01-15T12:00:00Z'),
    ...overrides,
  };
}

describe('Lead qualification hardening — 8A5', () => {
  describe('ownership and references', () => {
    it('preserves workspaceId', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      expect(lead.workspaceId).toBe('ws-1');
    });

    it('preserves icpProfileVersionId', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      expect(lead.icpProfileVersionId).toBe('icp-1-v1');
    });

    it('preserves accountId and contactId', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      expect(lead.accountId).toBe('acc-1');
      expect(lead.contactId).toBe('con-1');
    });
  });

  describe('snapshot versioning', () => {
    it('requires snapshotSchemaVersion', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      const result = lead.evaluate(baseInput({ snapshotSchemaVersion: '' }), corr(), evt());
      expect(result.success).toBe(false);
    });

    it('requires scoringPolicyVersion', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      const result = lead.evaluate(baseInput({ scoringPolicyVersion: '' }), corr(), evt());
      expect(result.success).toBe(false);
    });

    it('requires algorithmVersion', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      const result = lead.evaluate(baseInput({ algorithmVersion: '' }), corr(), evt());
      expect(result.success).toBe(false);
    });
  });

  describe('evaluatedAt', () => {
    it('preserves evaluatedAt as ISO string in snapshot', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      lead.evaluate(baseInput(), corr(), evt());
      expect(lead.qualificationSnapshot!.evaluatedAt).toBe('2026-01-15T12:00:00.000Z');
    });

    it('evaluatedAt is immutable — caller Date mutation has no effect', () => {
      const evalDate = new Date('2026-01-15T12:00:00Z');
      const lead = Lead.create(baseProps(), corr(), evt());
      lead.evaluate(baseInput({ evaluatedAt: evalDate }), corr(), evt());
      evalDate.setTime(0);
      expect(lead.qualificationSnapshot!.evaluatedAt).toBe('2026-01-15T12:00:00.000Z');
    });

    it('rejects invalid evaluatedAt', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      const result = lead.evaluate(baseInput({ evaluatedAt: new Date('invalid') }), corr(), evt());
      expect(result.success).toBe(false);
    });
  });

  describe('same snapshot replays to same outcome', () => {
    it('identical inputs produce identical snapshot fields', () => {
      const input = baseInput();
      const lead1 = Lead.create(baseProps(), corr(), evt());
      lead1.evaluate(input, corr(), evt());
      const lead2 = Lead.create(baseProps({ id: asLeadId('lead-2') }), corr(), evt());
      lead2.evaluate(input, corr(), evt());

      const s1 = lead1.qualificationSnapshot!;
      const s2 = lead2.qualificationSnapshot!;
      expect(s1.finalOutcome).toBe(s2.finalOutcome);
      expect(s1.reasonCodes).toEqual(s2.reasonCodes);
      expect(s1.scores).toEqual(s2.scores);
      expect(s1.thresholdsUsed).toEqual(s2.thresholdsUsed);
      expect(s1.evaluatedAt).toBe(s2.evaluatedAt);
    });
  });

  describe('decision rules', () => {
    it('hard filter failure → NOT_QUALIFIED with HARD_FILTER_FAIL codes', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      lead.evaluate(baseInput({
        hardFilterResults: [
          { filter: 'INDUSTRY', passed: false },
          { filter: 'GEOGRAPHY', passed: true },
        ],
      }), corr(), evt());
      expect(lead.status).toBe('NOT_QUALIFIED');
      expect(lead.qualificationSnapshot!.finalOutcome).toBe('NOT_QUALIFIED');
      expect(lead.qualificationSnapshot!.reasonCodes).toContain('HARD_FILTER_FAIL:INDUSTRY');
      expect(lead.qualificationSnapshot!.reasonCodes).not.toContain('HARD_FILTER_FAIL:GEOGRAPHY');
    });

    it('above qualification threshold → QUALIFIED', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      lead.evaluate(baseInput(), corr(), evt());
      expect(lead.status).toBe('QUALIFIED');
      expect(lead.qualificationSnapshot!.finalOutcome).toBe('QUALIFIED');
      expect(lead.qualificationSnapshot!.reasonCodes).toContain('SCORE_ABOVE_QUALIFICATION_THRESHOLD');
    });

    it('between review and qualification → NEEDS_REVIEW', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      const scores = { icpMatch: 0.6, signalScore: 0.5, intentScore: 0.55, evidenceConfidence: 0.6, overall: 0.6 };
      lead.evaluate(baseInput({ scores }), corr(), evt());
      expect(lead.status).toBe('NEEDS_REVIEW');
      expect(lead.qualificationSnapshot!.finalOutcome).toBe('NEEDS_REVIEW');
      expect(lead.qualificationSnapshot!.reasonCodes).toContain('SCORE_BETWEEN_REVIEW_AND_QUALIFICATION');
    });

    it('below review threshold → NOT_QUALIFIED', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      const scores = { icpMatch: 0.3, signalScore: 0.2, intentScore: 0.25, evidenceConfidence: 0.3, overall: 0.3 };
      lead.evaluate(baseInput({ scores }), corr(), evt());
      expect(lead.status).toBe('NOT_QUALIFIED');
      expect(lead.qualificationSnapshot!.finalOutcome).toBe('NOT_QUALIFIED');
      expect(lead.qualificationSnapshot!.reasonCodes).toContain('SCORE_BELOW_REVIEW_THRESHOLD');
    });

    it('every terminal decision has at least one reason code', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      lead.evaluate(baseInput(), corr(), evt());
      expect(lead.qualificationSnapshot!.reasonCodes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('snapshot contents', () => {
    it('preserves evidence IDs', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      lead.evaluate(baseInput({ evidenceIds: [asEvidenceId('ev-1'), asEvidenceId('ev-2')] }), corr(), evt());
      expect(lead.qualificationSnapshot!.evidenceIds).toEqual(['ev-1', 'ev-2']);
    });

    it('preserves signal IDs as branded SignalId', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      lead.evaluate(baseInput({ signalIds: [asSignalId('sig-1'), asSignalId('sig-2')] }), corr(), evt());
      expect(lead.qualificationSnapshot!.signalIds).toEqual(['sig-1', 'sig-2']);
    });

    it('preserves thresholds in snapshot', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      lead.evaluate(baseInput(), corr(), evt());
      expect(lead.qualificationSnapshot!.thresholdsUsed).toEqual({ qualification: 0.75, review: 0.55 });
    });

    it('preserves score components', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      lead.evaluate(baseInput(), corr(), evt());
      const s = lead.qualificationSnapshot!.scores;
      expect(s.icpMatch).toBe(0.9);
      expect(s.signalScore).toBe(0.8);
      expect(s.overall).toBe(0.85);
    });

    it('snapshot pins icpProfileId and icpProfileVersionId from Lead', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      lead.evaluate(baseInput(), corr(), evt());
      expect(lead.qualificationSnapshot!.icpProfileId).toBe('icp-1');
      expect(lead.qualificationSnapshot!.icpProfileVersionId).toBe('icp-1-v1');
    });

    it('reasoningArtifactId is optional reference only', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      lead.evaluate(baseInput({ reasoningArtifactId: 'artifact-123' }), corr(), evt());
      expect(lead.qualificationSnapshot!.reasoningArtifactId).toBe('artifact-123');
    });

    it('snapshot without reasoningArtifactId has no raw CoT', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      lead.evaluate(baseInput(), corr(), evt());
      expect(lead.qualificationSnapshot!.reasoningArtifactId).toBeUndefined();
    });
  });

  describe('snapshot immutability', () => {
    it('snapshot is immutable after evaluation', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      lead.evaluate(baseInput(), corr(), evt());
      const snap = lead.qualificationSnapshot!;
      expect(() => { (snap as any).finalOutcome = 'NOT_QUALIFIED'; }).toThrow();
      expect(() => { (snap.scores as any).overall = 0; }).toThrow();
      expect(() => { (snap.reasonCodes as any).push('INJECTED'); }).toThrow();
    });

    it('caller mutation of input arrays does not affect snapshot', () => {
      const evidenceIds = [asEvidenceId('ev-1')];
      const signalIds = [asSignalId('sig-1')];
      const features = { industry: 'Manufacturing' };
      const lead = Lead.create(baseProps(), corr(), evt());
      lead.evaluate(baseInput({ evidenceIds, signalIds, normalizedFeatures: features }), corr(), evt());
      evidenceIds.push(asEvidenceId('ev-injected'));
      signalIds.push(asSignalId('sig-injected'));
      (features as any).injected = true;
      expect(lead.qualificationSnapshot!.evidenceIds).toEqual(['ev-1']);
      expect(lead.qualificationSnapshot!.signalIds).toEqual(['sig-1']);
      expect(lead.qualificationSnapshot!.normalizedFeatures).toEqual({ industry: 'Manufacturing' });
    });

    it('post-evaluation top-level state matches snapshot (no drift)', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      lead.evaluate(baseInput(), corr(), evt());
      expect(lead.scores.overall).toBe(lead.qualificationSnapshot!.scores.overall);
      expect(lead.reasonCodes).toEqual([...lead.qualificationSnapshot!.reasonCodes]);
    });
  });

  describe('single-shot evaluation', () => {
    it('second evaluate() fails with LeadInvariantError', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      lead.evaluate(baseInput(), corr(), evt());
      const result = lead.evaluate(baseInput(), corr(), evt());
      expect(result.success).toBe(false);
      expect((result as any).error).toBeInstanceOf(LeadInvariantError);
    });
  });

  describe('human review preserves original snapshot', () => {
    it('approve does not mutate qualificationSnapshot', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      const scores = { icpMatch: 0.6, signalScore: 0.5, intentScore: 0.55, evidenceConfidence: 0.6, overall: 0.6 };
      lead.evaluate(baseInput({ scores }), corr(), evt());
      const originalOutcome = lead.qualificationSnapshot!.finalOutcome;
      expect(originalOutcome).toBe('NEEDS_REVIEW');
      lead.approve(corr(), evt());
      expect(lead.status).toBe('QUALIFIED');
      expect(lead.qualificationSnapshot!.finalOutcome).toBe('NEEDS_REVIEW');
      expect(lead.qualificationSnapshot!.evaluatedAt).toBe('2026-01-15T12:00:00.000Z');
    });

    it('reject does not mutate qualificationSnapshot', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      const scores = { icpMatch: 0.6, signalScore: 0.5, intentScore: 0.55, evidenceConfidence: 0.6, overall: 0.6 };
      lead.evaluate(baseInput({ scores }), corr(), evt());
      lead.reject('manual rejection', corr(), evt());
      expect(lead.status).toBe('NOT_QUALIFIED');
      expect(lead.qualificationSnapshot!.finalOutcome).toBe('NEEDS_REVIEW');
    });
  });

  describe('validation', () => {
    it('rejects qualificationThreshold < reviewThreshold', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      const result = lead.evaluate(baseInput({ qualificationThreshold: 0.5, reviewThreshold: 0.75 }), corr(), evt());
      expect(result.success).toBe(false);
    });

    it('rejects non-finite thresholds', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      const result = lead.evaluate(baseInput({ qualificationThreshold: Infinity }), corr(), evt());
      expect(result.success).toBe(false);
    });

    it('rejects non-finite scores', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      const scores = { icpMatch: NaN, signalScore: 0.5, intentScore: 0.5, evidenceConfidence: 0.5, overall: 0.5 };
      const result = lead.evaluate(baseInput({ scores }), corr(), evt());
      expect(result.success).toBe(false);
    });

    it('rejects non-JSON-safe normalizedFeatures', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      const result = lead.evaluate(baseInput({ normalizedFeatures: { fn: (() => {}) as any } }), corr(), evt());
      expect(result.success).toBe(false);
    });

    it('rejects invalid hard filter codes', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      const result = lead.evaluate(baseInput({
        hardFilterResults: [{ filter: 'ARBITRARY_TEXT', passed: false }],
      }) as any, corr(), evt());
      expect(result.success).toBe(false);
    });
  });

  describe('reconstitute', () => {
    it('restores from snapshot with no domain events', () => {
      const lead = Lead.create(baseProps(), corr(), evt());
      lead.evaluate(baseInput(), corr(), evt());
      const reconstituted = Lead.reconstitute(
        {
          ...baseProps(),
          status: lead.status,
          scores: { ...lead.scores },
          reasonCodes: [...lead.reasonCodes],
          qualificationSnapshot: lead.qualificationSnapshot,
        },
        3,
      );
      expect(reconstituted.status).toBe('QUALIFIED');
      expect(reconstituted.qualificationSnapshot!.finalOutcome).toBe('QUALIFIED');
      expect(reconstituted.version).toBe(3);
      expect(reconstituted.domainEvents).toHaveLength(0);
    });
  });
});
