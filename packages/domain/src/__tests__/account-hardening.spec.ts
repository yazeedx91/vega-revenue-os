import { asAccountId, asCorrelationId, asEventId, asEvidenceId, asTenantId } from '@projectx/shared';
import { Account, AccountInvariantError } from '../intelligence';

const tenantId = () => asTenantId('tenant-1');
const corr = () => asCorrelationId('corr-1');
const evt = () => asEventId('evt-1');

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    id: asAccountId('acc-1'),
    tenantId: tenantId(),
    workspaceId: 'ws-1',
    name: 'Acme Corp',
    domain: 'acme.com',
    industry: 'Manufacturing',
    employeeCount: 500,
    ...overrides,
  };
}

describe('Account hardening — 8A3', () => {
  describe('workspaceId ownership', () => {
    it('preserves workspaceId on discovery', () => {
      const account = Account.discover(baseProps(), 'provider', corr(), evt());
      expect(account.workspaceId).toBe('ws-1');
    });

    it('carries workspaceId through enrich', () => {
      const account = Account.discover(baseProps(), 'provider', corr(), evt());
      account.enrich({ territories: ['US'] }, [asEvidenceId('ev-1')], corr(), evt());
      expect(account.workspaceId).toBe('ws-1');
    });
  });

  describe('domain normalization', () => {
    it('lowercases uppercase input', () => {
      expect(Account.normalizeDomain('EXAMPLE.COM')).toBe('example.com');
    });

    it('strips scheme and path from URL form', () => {
      expect(Account.normalizeDomain('HTTPS://WWW.Example.COM/path?q=1')).toBe('example.com');
    });

    it('removes trailing dot', () => {
      expect(Account.normalizeDomain('example.com.')).toBe('example.com');
    });

    it('removes one leading www.', () => {
      expect(Account.normalizeDomain('www.example.co.uk')).toBe('example.co.uk');
    });

    it('preserves example.co.uk', () => {
      expect(Account.normalizeDomain('example.co.uk')).toBe('example.co.uk');
    });

    it('keeps example.com and example.ai distinct', () => {
      const a = Account.normalizeDomain('example.com');
      const b = Account.normalizeDomain('example.ai');
      expect(a).toBe('example.com');
      expect(b).toBe('example.ai');
      expect(a).not.toBe(b);
    });

    it('returns undefined for undefined domain', () => {
      expect(Account.normalizeDomain(undefined)).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(Account.normalizeDomain('')).toBeUndefined();
    });

    it('returns undefined for whitespace-only', () => {
      expect(Account.normalizeDomain('   ')).toBeUndefined();
    });

    it('strips port', () => {
      expect(Account.normalizeDomain('example.com:8080')).toBe('example.com');
    });

    it('strips query without path', () => {
      expect(Account.normalizeDomain('https://example.com?q=1')).toBe('example.com');
    });

    it('strips fragment', () => {
      expect(Account.normalizeDomain('https://example.com#section')).toBe('example.com');
    });

    it('auto-normalizes domain on Account creation', () => {
      const account = Account.discover(
        baseProps({ domain: 'HTTPS://WWW.Acme.COM/about' }),
        'provider',
        corr(),
        evt(),
      );
      expect(account.normalizedDomain).toBe('acme.com');
    });

    it('undefined domain yields undefined normalizedDomain', () => {
      const account = Account.discover(
        baseProps({ domain: undefined }),
        'provider',
        corr(),
        evt(),
      );
      expect(account.normalizedDomain).toBeUndefined();
    });
  });

  describe('dedup identity', () => {
    it('computes tenant:workspace:normalizedDomain when domain exists', () => {
      const account = Account.discover(baseProps(), 'provider', corr(), evt());
      expect(account.computeDedupIdentity()).toBe('tenant-1:ws-1:acme.com');
    });

    it('returns undefined when no domain', () => {
      const account = Account.discover(
        baseProps({ domain: undefined }),
        'provider',
        corr(),
        evt(),
      );
      expect(account.computeDedupIdentity()).toBeUndefined();
    });

    it('different workspaces yield different dedup identities for same domain', () => {
      const a = Account.discover(baseProps({ workspaceId: 'ws-1' }), 'p', corr(), evt());
      const b = Account.discover(baseProps({ id: asAccountId('acc-2'), workspaceId: 'ws-2' }), 'p', corr(), evt());
      expect(a.computeDedupIdentity()).not.toBe(b.computeDedupIdentity());
    });
  });

  describe('companySizeBand', () => {
    it.each(['STARTUP', 'SMB', 'MID_MARKET', 'ENTERPRISE'] as const)('accepts %s', (band) => {
      const account = Account.discover(
        baseProps({ companySizeBand: band }),
        'provider',
        corr(),
        evt(),
      );
      expect(account.companySizeBand).toBe(band);
    });

    it('defaults to undefined', () => {
      const account = Account.discover(baseProps(), 'provider', corr(), evt());
      expect(account.companySizeBand).toBeUndefined();
    });
  });

  describe('enrichmentState', () => {
    it('defaults to NONE', () => {
      const account = Account.discover(baseProps(), 'provider', corr(), evt());
      expect(account.enrichmentState).toBe('NONE');
    });

    it.each(['NONE', 'PARTIAL', 'COMPLETE'] as const)('accepts %s', (state) => {
      const account = Account.discover(
        baseProps({ enrichmentState: state }),
        'provider',
        corr(),
        evt(),
      );
      expect(account.enrichmentState).toBe(state);
    });

    it('enrichment state independent of lifecycle status', () => {
      const account = Account.discover(
        baseProps({ enrichmentState: 'PARTIAL' }),
        'provider',
        corr(),
        evt(),
      );
      account.enrich({ enrichmentState: 'COMPLETE' }, [asEvidenceId('ev-1')], corr(), evt());
      expect(account.status).toBe('ENRICHED');
      expect(account.enrichmentState).toBe('COMPLETE');
    });
  });

  describe('accountVersion (optimistic concurrency)', () => {
    it('initial version is 1', () => {
      const account = Account.discover(baseProps(), 'provider', corr(), evt());
      expect(account.accountVersion).toBe(1);
    });

    it('enrich increments version exactly once', () => {
      const account = Account.discover(baseProps(), 'provider', corr(), evt());
      expect(account.accountVersion).toBe(1);
      account.enrich({}, [asEvidenceId('ev-1')], corr(), evt());
      expect(account.accountVersion).toBe(2);
    });

    it('markDuplicate increments version exactly once', () => {
      const account = Account.discover(baseProps(), 'provider', corr(), evt());
      account.markDuplicate(asAccountId('acc-canonical'), 'dup', corr(), evt());
      expect(account.accountVersion).toBe(2);
    });

    it('disqualify increments version exactly once', () => {
      const account = Account.discover(baseProps(), 'provider', corr(), evt());
      account.disqualify('reason', corr(), evt());
      expect(account.accountVersion).toBe(2);
    });

    it('qualify increments version exactly once', () => {
      const account = Account.discover(baseProps(), 'provider', corr(), evt());
      account.qualify(corr(), evt());
      expect(account.accountVersion).toBe(2);
    });

    it('rejects version 0 on creation', () => {
      expect(() =>
        Account.discover(baseProps({ accountVersion: 0 }), 'p', corr(), evt()),
      ).toThrow(AccountInvariantError);
    });

    it('rejects negative version on creation', () => {
      expect(() =>
        Account.discover(baseProps({ accountVersion: -1 }), 'p', corr(), evt()),
      ).toThrow(AccountInvariantError);
    });

    it('rejects NaN version on creation', () => {
      expect(() =>
        Account.discover(baseProps({ accountVersion: NaN }), 'p', corr(), evt()),
      ).toThrow(AccountInvariantError);
    });

    it('rejects fractional version on creation', () => {
      expect(() =>
        Account.discover(baseProps({ accountVersion: 1.5 }), 'p', corr(), evt()),
      ).toThrow(AccountInvariantError);
    });
  });

  describe('existing lifecycle preservation', () => {
    it('discover → enrich → qualify lifecycle', () => {
      const account = Account.discover(baseProps(), 'provider', corr(), evt());
      expect(account.status).toBe('DISCOVERED');
      account.enrich({ territories: ['US'] }, [asEvidenceId('ev-1')], corr(), evt());
      expect(account.status).toBe('ENRICHED');
      account.qualify(corr(), evt());
      expect(account.status).toBe('QUALIFIED');
    });

    it('duplicate linkage preserved', () => {
      const account = Account.discover(baseProps(), 'provider', corr(), evt());
      account.markDuplicate(asAccountId('acc-canonical'), 'name match', corr(), evt());
      expect(account.status).toBe('DUPLICATE');
      expect(account.duplicateOf).toBe('acc-canonical');
    });

    it('disqualification reason preserved via event', () => {
      const account = Account.discover(baseProps(), 'provider', corr(), evt());
      account.disqualify('territory mismatch', corr(), evt());
      expect(account.status).toBe('DISQUALIFIED');
      const event = account.domainEvents.find((e) => e.eventType === 'AccountDisqualified') as any;
      expect(event.payload.reason).toBe('territory mismatch');
    });

    it('evidence references preserved across enrich', () => {
      const account = Account.discover(baseProps(), 'provider', corr(), evt());
      account.enrich({}, [asEvidenceId('ev-1'), asEvidenceId('ev-2')], corr(), evt());
      expect(account.evidenceReferences).toEqual(['ev-1', 'ev-2']);
    });
  });

  describe('reconstitute', () => {
    it('restores from snapshot with no domain events', () => {
      const account = Account.reconstitute(
        { ...baseProps(), status: 'ENRICHED', enrichmentState: 'COMPLETE', accountVersion: 5 },
        3,
      );
      expect(account.status).toBe('ENRICHED');
      expect(account.enrichmentState).toBe('COMPLETE');
      expect(account.accountVersion).toBe(5);
      expect(account.version).toBe(3);
      expect(account.domainEvents).toHaveLength(0);
    });
  });

  describe('geography', () => {
    it('carries geography through creation', () => {
      const account = Account.discover(
        baseProps({ geography: 'North America' }),
        'provider',
        corr(),
        evt(),
      );
      expect(account.geography).toBe('North America');
    });

    it('defaults to undefined', () => {
      const account = Account.discover(baseProps(), 'provider', corr(), evt());
      expect(account.geography).toBeUndefined();
    });
  });
});
