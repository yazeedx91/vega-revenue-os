import { asAccountId, asContactId, asCorrelationId, asEventId, asEvidenceId, asSignalId, asTenantId } from '@projectx/shared';
import { Signal, SignalInvariantError, SIGNAL_CATEGORIES } from '../intelligence';

const tenantId = () => asTenantId('tenant-1');
const corr = () => asCorrelationId('corr-1');
const evt = () => asEventId('evt-1');

function defaultSignalProps() {
  const now = new Date();
  return {
    id: asSignalId('sig-1'),
    tenantId: tenantId(),
    workspaceId: 'ws-1',
    accountId: asAccountId('acc-1'),
    signalType: 'Funding' as const,
    observedAt: now,
    effectiveFrom: now,
    effectiveUntil: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    source: 'provider-x',
    confidence: 0.85,
    relevance: 0.9,
    observedSignal: 'Company raised $50M Series B',
    interpretedSignal: 'Strong growth signal indicating expansion budget',
    evidenceIds: [asEvidenceId('ev-1')],
  };
}

describe('Signal', () => {
  describe('detect', () => {
    it('creates an ACTIVE signal with correct properties', () => {
      const signal = Signal.detect(defaultSignalProps(), corr(), evt());
      expect(signal.status).toBe('ACTIVE');
      expect(signal.signalType).toBe('Funding');
      expect(signal.confidence).toBe(0.85);
      expect(signal.relevance).toBe(0.9);
      expect(signal.accountId).toBe('acc-1');
      expect(signal.evidenceIds).toEqual([asEvidenceId('ev-1')]);
      expect(signal.domainEvents).toHaveLength(1);
      expect(signal.domainEvents[0]?.eventType).toBe('SignalDetected');
    });

    it('computes deterministic dedup identity', () => {
      const props = defaultSignalProps();
      const s1 = Signal.detect(props, corr(), evt());
      const s2 = Signal.detect({ ...props, id: asSignalId('sig-2') }, corr(), evt());
      expect(s1.dedupIdentity).toBe(s2.dedupIdentity);
    });

    it('produces different dedup identity for different observed signals', () => {
      const props = defaultSignalProps();
      const s1 = Signal.detect(props, corr(), evt());
      const s2 = Signal.detect(
        { ...props, id: asSignalId('sig-2'), observedSignal: 'Different event observed' },
        corr(),
        evt(),
      );
      expect(s1.dedupIdentity).not.toBe(s2.dedupIdentity);
    });

    it('produces different dedup identity for different signal types', () => {
      const props = defaultSignalProps();
      const s1 = Signal.detect(props, corr(), evt());
      const s2 = Signal.detect(
        { ...props, id: asSignalId('sig-2'), signalType: 'Leadership' as const },
        corr(),
        evt(),
      );
      expect(s1.dedupIdentity).not.toBe(s2.dedupIdentity);
    });

    it('rejects confidence < 0', () => {
      const props = { ...defaultSignalProps(), confidence: -0.1 };
      expect(() => Signal.detect(props, corr(), evt())).toThrow(SignalInvariantError);
    });

    it('rejects confidence > 1', () => {
      const props = { ...defaultSignalProps(), confidence: 1.5 };
      expect(() => Signal.detect(props, corr(), evt())).toThrow(SignalInvariantError);
    });

    it('rejects relevance < 0', () => {
      const props = { ...defaultSignalProps(), relevance: -0.1 };
      expect(() => Signal.detect(props, corr(), evt())).toThrow(SignalInvariantError);
    });

    it('rejects relevance > 1', () => {
      const props = { ...defaultSignalProps(), relevance: 1.5 };
      expect(() => Signal.detect(props, corr(), evt())).toThrow(SignalInvariantError);
    });

    it('rejects empty observed signal', () => {
      const props = { ...defaultSignalProps(), observedSignal: '  ' };
      expect(() => Signal.detect(props, corr(), evt())).toThrow(SignalInvariantError);
    });

    it('rejects invalid signal category', () => {
      const props = { ...defaultSignalProps(), signalType: 'InvalidCategory' as any };
      expect(() => Signal.detect(props, corr(), evt())).toThrow(SignalInvariantError);
    });

    it('rejects effectiveUntil not after effectiveFrom', () => {
      const now = new Date();
      const props = { ...defaultSignalProps(), effectiveFrom: now, effectiveUntil: now };
      expect(() => Signal.detect(props, corr(), evt())).toThrow(SignalInvariantError);
    });

    it('accepts optional contactId', () => {
      const props = { ...defaultSignalProps(), contactId: asContactId('con-1') };
      const signal = Signal.detect(props, corr(), evt());
      expect(signal.contactId).toBe('con-1');
    });

    it('accepts optional workspaceId', () => {
      const props = { ...defaultSignalProps(), workspaceId: 'ws-1' };
      const signal = Signal.detect(props, corr(), evt());
      expect(signal.workspaceId).toBe('ws-1');
    });
  });

  describe('reconstitute', () => {
    it('restores from snapshot with version', () => {
      const props = { ...defaultSignalProps(), status: 'ACTIVE' as const };
      const signal = Signal.reconstitute(props, 3);
      expect(signal.version).toBe(3);
      expect(signal.loadedVersion).toBe(3);
      expect(signal.domainEvents).toHaveLength(0);
      expect(signal.status).toBe('ACTIVE');
    });
  });

  describe('isActive / isExpired', () => {
    it('returns active when within effective window', () => {
      const signal = Signal.detect(defaultSignalProps(), corr(), evt());
      expect(signal.isActive()).toBe(true);
      expect(signal.isExpired()).toBe(false);
    });

    it('returns expired when past effective window', () => {
      const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const props = {
        ...defaultSignalProps(),
        effectiveFrom: new Date(past.getTime() - 7 * 24 * 60 * 60 * 1000),
        effectiveUntil: past,
      };
      const signal = Signal.detect(props, corr(), evt());
      expect(signal.isActive()).toBe(false);
      expect(signal.isExpired()).toBe(true);
    });

    it('evaluates freshness at a specific point in time', () => {
      const signal = Signal.detect(defaultSignalProps(), corr(), evt());
      const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      expect(signal.isActive(future)).toBe(false);
      expect(signal.isExpired(future)).toBe(true);
    });
  });

  describe('expire', () => {
    it('transitions ACTIVE to EXPIRED with event', () => {
      const signal = Signal.detect(defaultSignalProps(), corr(), evt());
      signal.expire(corr(), evt());
      expect(signal.status).toBe('EXPIRED');
      expect(signal.domainEvents.some((e) => e.eventType === 'SignalExpired')).toBe(true);
    });

    it('is idempotent for non-ACTIVE signals', () => {
      const signal = Signal.detect(defaultSignalProps(), corr(), evt());
      signal.retract('invalid data', corr(), evt());
      const eventCount = signal.domainEvents.length;
      signal.expire(corr(), evt());
      expect(signal.domainEvents).toHaveLength(eventCount);
      expect(signal.status).toBe('RETRACTED');
    });
  });

  describe('retract', () => {
    it('transitions ACTIVE to RETRACTED with event', () => {
      const signal = Signal.detect(defaultSignalProps(), corr(), evt());
      signal.retract('data source unreliable', corr(), evt());
      expect(signal.status).toBe('RETRACTED');
      expect(signal.domainEvents.some((e) => e.eventType === 'SignalRetracted')).toBe(true);
    });

    it('transitions EXPIRED to RETRACTED', () => {
      const signal = Signal.detect(defaultSignalProps(), corr(), evt());
      signal.expire(corr(), evt());
      signal.retract('data source unreliable', corr(), evt());
      expect(signal.status).toBe('RETRACTED');
    });

    it('is idempotent for already-retracted signals', () => {
      const signal = Signal.detect(defaultSignalProps(), corr(), evt());
      signal.retract('reason 1', corr(), evt());
      const eventCount = signal.domainEvents.length;
      signal.retract('reason 2', corr(), evt());
      expect(signal.domainEvents).toHaveLength(eventCount);
    });
  });

  describe('SIGNAL_CATEGORIES', () => {
    it('contains exactly 9 binding categories', () => {
      expect(SIGNAL_CATEGORIES).toHaveLength(9);
      expect(SIGNAL_CATEGORIES).toContain('Growth');
      expect(SIGNAL_CATEGORIES).toContain('Funding');
      expect(SIGNAL_CATEGORIES).toContain('Leadership');
      expect(SIGNAL_CATEGORIES).toContain('Technology');
      expect(SIGNAL_CATEGORIES).toContain('DigitalTransformation');
      expect(SIGNAL_CATEGORIES).toContain('BusinessChange');
      expect(SIGNAL_CATEGORIES).toContain('PainIndicators');
      expect(SIGNAL_CATEGORIES).toContain('CompetitivePressure');
      expect(SIGNAL_CATEGORIES).toContain('IndustryTailwinds');
    });
  });
});
