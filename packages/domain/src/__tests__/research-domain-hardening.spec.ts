import {
  asAccountId, asEvidenceId, asResearchRequestId, asResearchRunId, asTenantId,
} from '@projectx/shared';
import {
  ResearchEvidence,
  EvidenceInvariantError,
  ResearchRequest,
  ResearchRun,
  ResearchDomainError,
} from '../intelligence';
import type { ResearchEvidenceProps } from '../intelligence/research-evidence';

const tenantId = () => asTenantId('tenant-1');

function baseEvidenceProps(overrides: Partial<ResearchEvidenceProps> = {}): ResearchEvidenceProps {
  return {
    evidenceId: asEvidenceId('ev-1'),
    tenantId: tenantId(),
    workspaceId: 'ws-1',
    requestId: asResearchRequestId('req-1'),
    runId: asResearchRunId('run-1'),
    accountId: asAccountId('acc-1'),
    claimType: 'EMPLOYEE_COUNT',
    normalizedValue: 500,
    source: 'provider',
    reliabilityTier: 'PREMIUM_PROVIDER',
    observedAt: '2026-01-15T12:00:00.000Z',
    freshnessExpiry: '2026-02-15T12:00:00.000Z',
    confidence: 0.85,
    confidenceBreakdown: { sourceReliability: 0.8, extractionConfidence: 0.9, corroboration: 0 },
    provenance: [{ step: 'provider-lookup', inputSummary: 'lookup', outputSummary: '500', occurredAt: '2026-01-15T12:00:00.000Z' }],
    evidenceFingerprint: 'fp-abc123def',
    ...overrides,
  };
}

describe('Research domain hardening — 8A6', () => {
  describe('branded identities', () => {
    it('ResearchRequestId is a branded type', () => {
      const id = asResearchRequestId('req-1');
      expect(typeof id).toBe('string');
      expect(id).toBe('req-1');
    });

    it('ResearchRunId is a branded type', () => {
      const id = asResearchRunId('run-1');
      expect(typeof id).toBe('string');
      expect(id).toBe('run-1');
    });
  });

  describe('ResearchRequest', () => {
    it('creates with valid props', () => {
      const request = ResearchRequest.create({
        id: asResearchRequestId('req-1'),
        tenantId: tenantId(),
        workspaceId: 'ws-1',
        missionId: 'mission-1',
        queryHash: 'abc123def456',
        requestedAt: '2026-01-15T12:00:00.000Z',
      });
      expect(request.id).toBe('req-1');
      expect(request.tenantId).toBe('tenant-1');
      expect(request.workspaceId).toBe('ws-1');
      expect(request.queryHash).toBe('abc123def456');
    });

    it('preserves tenantId and workspaceId', () => {
      const request = ResearchRequest.create({
        id: asResearchRequestId('req-2'),
        tenantId: tenantId(),
        workspaceId: 'ws-2',
        queryHash: 'xyz789',
        requestedAt: '2026-01-15T12:00:00.000Z',
      });
      expect(request.tenantId).toBe('tenant-1');
      expect(request.workspaceId).toBe('ws-2');
    });

    it('rejects empty queryHash', () => {
      expect(() => ResearchRequest.create({
        id: asResearchRequestId('req-3'),
        tenantId: tenantId(),
        workspaceId: 'ws-1',
        queryHash: '',
        requestedAt: '2026-01-15T12:00:00.000Z',
      })).toThrow(ResearchDomainError);
    });

    it('rejects queryHash with invalid characters', () => {
      expect(() => ResearchRequest.create({
        id: asResearchRequestId('req-3'),
        tenantId: tenantId(),
        workspaceId: 'ws-1',
        queryHash: 'has spaces!',
        requestedAt: '2026-01-15T12:00:00.000Z',
      })).toThrow(ResearchDomainError);
    });

    it('rejects queryHash exceeding max length', () => {
      expect(() => ResearchRequest.create({
        id: asResearchRequestId('req-3'),
        tenantId: tenantId(),
        workspaceId: 'ws-1',
        queryHash: 'a'.repeat(257),
        requestedAt: '2026-01-15T12:00:00.000Z',
      })).toThrow(ResearchDomainError);
    });

    it('rejects invalid requestedAt', () => {
      expect(() => ResearchRequest.create({
        id: asResearchRequestId('req-3'),
        tenantId: tenantId(),
        workspaceId: 'ws-1',
        queryHash: 'abc123',
        requestedAt: 'not-a-date',
      })).toThrow(ResearchDomainError);
    });

    it('is immutable after creation', () => {
      const request = ResearchRequest.create({
        id: asResearchRequestId('req-1'),
        tenantId: tenantId(),
        workspaceId: 'ws-1',
        queryHash: 'abc123',
        requestedAt: '2026-01-15T12:00:00.000Z',
      });
      expect(() => { (request as any).queryHash = 'changed'; }).toThrow();
    });
  });

  describe('ResearchRun lifecycle', () => {
    function createRun() {
      return ResearchRun.create({
        id: asResearchRunId('run-1'),
        tenantId: tenantId(),
        workspaceId: 'ws-1',
        requestId: asResearchRequestId('req-1'),
      });
    }

    it('creates in PENDING status', () => {
      const run = createRun();
      expect(run.status).toBe('PENDING');
      expect(run.startedAt).toBeUndefined();
      expect(run.completedAt).toBeUndefined();
    });

    it('preserves tenantId and workspaceId', () => {
      const run = createRun();
      expect(run.tenantId).toBe('tenant-1');
      expect(run.workspaceId).toBe('ws-1');
      expect(run.requestId).toBe('req-1');
    });

    it('transitions PENDING → RUNNING with startedAt', () => {
      const run = createRun();
      run.start('2026-01-15T12:00:00.000Z');
      expect(run.status).toBe('RUNNING');
      expect(run.startedAt).toBe('2026-01-15T12:00:00.000Z');
    });

    it('transitions RUNNING → SUCCEEDED with completedAt', () => {
      const run = createRun();
      run.start('2026-01-15T12:00:00.000Z');
      run.succeed('2026-01-15T12:05:00.000Z');
      expect(run.status).toBe('SUCCEEDED');
      expect(run.completedAt).toBe('2026-01-15T12:05:00.000Z');
      expect(run.failureCode).toBeUndefined();
      expect(run.failureMessage).toBeUndefined();
    });

    it('transitions RUNNING → FAILED with failure metadata', () => {
      const run = createRun();
      run.start('2026-01-15T12:00:00.000Z');
      run.fail('RESEARCH_RUN_FAILED', 'Provider unavailable', '2026-01-15T12:05:00.000Z');
      expect(run.status).toBe('FAILED');
      expect(run.completedAt).toBe('2026-01-15T12:05:00.000Z');
      expect(run.failureCode).toBe('RESEARCH_RUN_FAILED');
      expect(run.failureMessage).toBe('Provider unavailable');
    });

    it('rejects PENDING → SUCCEEDED', () => {
      const run = createRun();
      expect(() => run.succeed('2026-01-15T12:05:00.000Z')).toThrow(ResearchDomainError);
    });

    it('rejects PENDING → FAILED', () => {
      const run = createRun();
      expect(() => run.fail('CODE', 'msg', '2026-01-15T12:05:00.000Z')).toThrow(ResearchDomainError);
    });

    it('rejects SUCCEEDED → anything', () => {
      const run = createRun();
      run.start('2026-01-15T12:00:00.000Z');
      run.succeed('2026-01-15T12:05:00.000Z');
      expect(() => run.start('2026-01-15T12:10:00.000Z')).toThrow(ResearchDomainError);
      expect(() => run.succeed('2026-01-15T12:10:00.000Z')).toThrow(ResearchDomainError);
      expect(() => run.fail('CODE', 'msg', '2026-01-15T12:10:00.000Z')).toThrow(ResearchDomainError);
    });

    it('rejects FAILED → anything', () => {
      const run = createRun();
      run.start('2026-01-15T12:00:00.000Z');
      run.fail('CODE', 'msg', '2026-01-15T12:05:00.000Z');
      expect(() => run.start('2026-01-15T12:10:00.000Z')).toThrow(ResearchDomainError);
      expect(() => run.succeed('2026-01-15T12:10:00.000Z')).toThrow(ResearchDomainError);
      expect(() => run.fail('CODE2', 'msg', '2026-01-15T12:10:00.000Z')).toThrow(ResearchDomainError);
    });

    it('validates completedAt >= startedAt', () => {
      const run = createRun();
      run.start('2026-01-15T12:05:00.000Z');
      expect(() => run.succeed('2026-01-15T11:00:00.000Z')).toThrow(ResearchDomainError);
    });

    it('rejects empty failureCode on fail', () => {
      const run = createRun();
      run.start('2026-01-15T12:00:00.000Z');
      expect(() => run.fail('', 'msg', '2026-01-15T12:05:00.000Z')).toThrow(ResearchDomainError);
    });

    it('timestamps are explicit inputs — no wall-clock calls', () => {
      const run = createRun();
      run.start('2000-01-01T00:00:00.000Z');
      run.succeed('2000-01-01T00:00:01.000Z');
      expect(run.startedAt).toBe('2000-01-01T00:00:00.000Z');
      expect(run.completedAt).toBe('2000-01-01T00:00:01.000Z');
    });
  });

  describe('ResearchEvidence — ownership and provenance', () => {
    it('preserves tenantId, workspaceId, requestId, runId', () => {
      const ev = new ResearchEvidence(baseEvidenceProps());
      expect(ev.props.tenantId).toBe('tenant-1');
      expect(ev.props.workspaceId).toBe('ws-1');
      expect(ev.props.requestId).toBe('req-1');
      expect(ev.props.runId).toBe('run-1');
    });

    it('evidence references exact requestId and runId', () => {
      const ev = new ResearchEvidence(baseEvidenceProps({
        requestId: asResearchRequestId('req-42'),
        runId: asResearchRunId('run-77'),
      }));
      expect(ev.props.requestId).toBe('req-42');
      expect(ev.props.runId).toBe('run-77');
    });
  });

  describe('ResearchEvidence — evidenceFingerprint', () => {
    it('has explicit fingerprint/dedup identity', () => {
      const ev = new ResearchEvidence(baseEvidenceProps());
      expect(ev.props.evidenceFingerprint).toBe('fp-abc123def');
    });

    it('rejects empty fingerprint', () => {
      expect(() => new ResearchEvidence(baseEvidenceProps({ evidenceFingerprint: '' }))).toThrow(EvidenceInvariantError);
    });

    it('rejects fingerprint exceeding max length', () => {
      expect(() => new ResearchEvidence(baseEvidenceProps({ evidenceFingerprint: 'a'.repeat(257) }))).toThrow(EvidenceInvariantError);
    });

    it('rejects fingerprint with non-machine-safe characters', () => {
      expect(() => new ResearchEvidence(baseEvidenceProps({ evidenceFingerprint: 'has spaces!' }))).toThrow(EvidenceInvariantError);
    });

    it('accepts valid base64url-safe fingerprint', () => {
      const ev = new ResearchEvidence(baseEvidenceProps({ evidenceFingerprint: 'abc_DEF-123' }));
      expect(ev.props.evidenceFingerprint).toBe('abc_DEF-123');
    });
  });

  describe('ResearchEvidence — confidence/reliability validation', () => {
    it('rejects confidence outside [0,1]', () => {
      expect(() => new ResearchEvidence(baseEvidenceProps({ confidence: 1.5 }))).toThrow(EvidenceInvariantError);
      expect(() => new ResearchEvidence(baseEvidenceProps({ confidence: -0.1 }))).toThrow(EvidenceInvariantError);
    });

    it('rejects NaN confidence', () => {
      expect(() => new ResearchEvidence(baseEvidenceProps({ confidence: NaN }))).toThrow(EvidenceInvariantError);
    });

    it('rejects Infinity confidence', () => {
      expect(() => new ResearchEvidence(baseEvidenceProps({ confidence: Infinity }))).toThrow(EvidenceInvariantError);
    });

    it('rejects breakdown components outside [0,1]', () => {
      expect(() => new ResearchEvidence(baseEvidenceProps({
        confidenceBreakdown: { sourceReliability: 1.5, extractionConfidence: 0.5, corroboration: 0 },
      }))).toThrow(EvidenceInvariantError);
    });

    it('rejects NaN in breakdown', () => {
      expect(() => new ResearchEvidence(baseEvidenceProps({
        confidenceBreakdown: { sourceReliability: NaN, extractionConfidence: 0.5, corroboration: 0 },
      }))).toThrow(EvidenceInvariantError);
    });
  });

  describe('ResearchEvidence — immutability', () => {
    it('evidence props are frozen after creation', () => {
      const ev = new ResearchEvidence(baseEvidenceProps());
      expect(() => { (ev.props as any).confidence = 0; }).toThrow();
      expect(() => { (ev.props as any).claimType = 'CHANGED'; }).toThrow();
    });

    it('caller mutation of provenance array does not affect evidence', () => {
      const provenance = [{ step: 'p1', inputSummary: 'in', outputSummary: 'out', occurredAt: '2026-01-15T12:00:00.000Z' }];
      const ev = new ResearchEvidence(baseEvidenceProps({ provenance }));
      provenance.push({ step: 'injected', inputSummary: '', outputSummary: '', occurredAt: '2026-01-15T12:00:00.000Z' });
      expect(ev.props.provenance.length).toBe(1);
    });

    it('caller mutation of contradictions does not affect evidence', () => {
      const contradictions = [{ conflictingEvidenceId: asEvidenceId('ev-2'), reason: 'diff', resolution: 'UNRESOLVED' as const }];
      const ev = new ResearchEvidence(baseEvidenceProps({ contradictions }));
      contradictions.push({ conflictingEvidenceId: asEvidenceId('ev-injected'), reason: 'x', resolution: 'UNRESOLVED' });
      expect(ev.props.contradictions!.length).toBe(1);
    });

    it('caller mutation of normalizedValue does not affect evidence', () => {
      const value = { count: 500, nested: { a: 1 } };
      const ev = new ResearchEvidence(baseEvidenceProps({ normalizedValue: value }));
      value.count = 999;
      (value.nested as any).a = 999;
      expect((ev.props.normalizedValue as any).count).toBe(500);
      expect((ev.props.normalizedValue as any).nested.a).toBe(1);
    });

    it('timestamps are immutable ISO strings', () => {
      const ev = new ResearchEvidence(baseEvidenceProps());
      expect(ev.props.observedAt).toBe('2026-01-15T12:00:00.000Z');
      expect(ev.props.freshnessExpiry).toBe('2026-02-15T12:00:00.000Z');
    });
  });

  describe('ResearchEvidence — normalizedValue JSON safety', () => {
    it('rejects functions in normalizedValue', () => {
      expect(() => new ResearchEvidence(baseEvidenceProps({ normalizedValue: (() => {}) as any }))).toThrow(EvidenceInvariantError);
    });

    it('rejects NaN in normalizedValue', () => {
      expect(() => new ResearchEvidence(baseEvidenceProps({ normalizedValue: NaN as any }))).toThrow(EvidenceInvariantError);
    });

    it('rejects undefined in normalizedValue', () => {
      expect(() => new ResearchEvidence(baseEvidenceProps({ normalizedValue: undefined as any }))).toThrow(EvidenceInvariantError);
    });

    it('accepts valid JSON-safe values', () => {
      const ev = new ResearchEvidence(baseEvidenceProps({ normalizedValue: { arr: [1, 'two', true, null] } }));
      expect(ev.props.normalizedValue).toEqual({ arr: [1, 'two', true, null] });
    });
  });

  describe('ResearchEvidence — sourceUri safety', () => {
    it('rejects sourceUri with embedded credentials', () => {
      expect(() => new ResearchEvidence(baseEvidenceProps({
        sourceUri: 'https://user:password@example.com/data',
      }))).toThrow(EvidenceInvariantError);
    });

    it('accepts clean sourceUri', () => {
      const ev = new ResearchEvidence(baseEvidenceProps({ sourceUri: 'https://example.com/data' }));
      expect(ev.props.sourceUri).toBe('https://example.com/data');
    });

    it('rejects sourceUri exceeding max length', () => {
      expect(() => new ResearchEvidence(baseEvidenceProps({
        sourceUri: 'https://example.com/' + 'a'.repeat(2048),
      }))).toThrow(EvidenceInvariantError);
    });
  });

  describe('ResearchEvidence — no raw provider payload / CoT / authority fields', () => {
    it('has no rawClaim field', () => {
      const ev = new ResearchEvidence(baseEvidenceProps());
      expect('rawClaim' in ev.props).toBe(false);
    });

    it('canonical shape contains only approved fields', () => {
      const ev = new ResearchEvidence(baseEvidenceProps());
      const keys = Object.keys(ev.props).sort();
      const approved = [
        'accountId', 'claimType', 'confidence', 'confidenceBreakdown',
        'contradictions', 'evidenceFingerprint', 'evidenceId', 'freshnessExpiry',
        'missionId', 'normalizedValue', 'observedAt', 'provenance',
        'reliabilityTier', 'requestId', 'runId', 'source', 'sourceUri',
        'tenantId', 'workspaceId',
      ].sort();
      for (const key of keys) {
        if ((ev.props as any)[key] !== undefined) {
          expect(approved).toContain(key);
        }
      }
    });
  });

  describe('ResearchEvidence — source bounds', () => {
    it('rejects empty source', () => {
      expect(() => new ResearchEvidence(baseEvidenceProps({ source: '' }))).toThrow(EvidenceInvariantError);
    });

    it('rejects source exceeding max length', () => {
      expect(() => new ResearchEvidence(baseEvidenceProps({ source: 'a'.repeat(513) }))).toThrow(EvidenceInvariantError);
    });

    it('rejects empty claimType', () => {
      expect(() => new ResearchEvidence(baseEvidenceProps({ claimType: '' }))).toThrow(EvidenceInvariantError);
    });
  });

  describe('ResearchRun reconstitute', () => {
    it('restores from props without enforcing lifecycle', () => {
      const run = ResearchRun.reconstitute({
        id: asResearchRunId('run-1'),
        tenantId: tenantId(),
        workspaceId: 'ws-1',
        requestId: asResearchRequestId('req-1'),
        status: 'SUCCEEDED',
        startedAt: '2026-01-15T12:00:00.000Z',
        completedAt: '2026-01-15T12:05:00.000Z',
      });
      expect(run.status).toBe('SUCCEEDED');
      expect(run.startedAt).toBe('2026-01-15T12:00:00.000Z');
    });
  });
});
