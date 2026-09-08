import { asAccountId, asContactId, asCorrelationId, asEventId, asEvidenceId, asTenantId } from '@projectx/shared';
import { Contact, ContactInvariantError } from '../intelligence';

const tenantId = () => asTenantId('tenant-1');
const corr = () => asCorrelationId('corr-1');
const evt = () => asEventId('evt-1');

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    id: asContactId('con-1'),
    tenantId: tenantId(),
    workspaceId: 'ws-1',
    accountId: asAccountId('acc-1'),
    name: 'Jane Doe',
    ...overrides,
  };
}

describe('Contact hardening — 8A4', () => {
  describe('workspace ownership', () => {
    it('preserves workspaceId on discovery', () => {
      const contact = Contact.discover(baseProps(), 'provider', corr(), evt());
      expect(contact.workspaceId).toBe('ws-1');
    });

    it('carries workspaceId through enrich', () => {
      const contact = Contact.discover(baseProps(), 'provider', corr(), evt());
      contact.enrich({ title: 'VP Sales' }, [asEvidenceId('ev-1')], corr(), evt());
      expect(contact.workspaceId).toBe('ws-1');
    });

    it('preserves accountId', () => {
      const contact = Contact.discover(baseProps(), 'provider', corr(), evt());
      expect(contact.accountId).toBe('acc-1');
    });
  });

  describe('department and functionRole', () => {
    it('preserves department', () => {
      const contact = Contact.discover(baseProps({ department: 'Sales' }), 'provider', corr(), evt());
      expect(contact.department).toBe('Sales');
    });

    it('preserves functionRole', () => {
      const contact = Contact.discover(baseProps({ functionRole: 'Decision Maker' }), 'provider', corr(), evt());
      expect(contact.functionRole).toBe('Decision Maker');
    });

    it('defaults department to undefined', () => {
      const contact = Contact.discover(baseProps(), 'provider', corr(), evt());
      expect(contact.department).toBeUndefined();
    });

    it('defaults functionRole to undefined', () => {
      const contact = Contact.discover(baseProps(), 'provider', corr(), evt());
      expect(contact.functionRole).toBeUndefined();
    });
  });

  describe('verification state', () => {
    it('defaults to UNVERIFIED', () => {
      const contact = Contact.discover(baseProps(), 'provider', corr(), evt());
      expect(contact.verificationState).toBe('UNVERIFIED');
    });

    it('transitions to VERIFIED', () => {
      const contact = Contact.discover(baseProps(), 'provider', corr(), evt());
      contact.verify(corr(), evt());
      expect(contact.verificationState).toBe('VERIFIED');
    });

    it('transitions to BOUNCED', () => {
      const contact = Contact.discover(baseProps(), 'provider', corr(), evt());
      contact.markBounced(corr(), evt());
      expect(contact.verificationState).toBe('BOUNCED');
    });
  });

  describe('suppression — terminal', () => {
    it('SUPPRESSED contact cannot be enriched', () => {
      const contact = Contact.discover(baseProps(), 'provider', corr(), evt());
      contact.suppress('opt-out', corr(), evt());
      expect(() =>
        contact.enrich({ title: 'New Title' }, [asEvidenceId('ev-1')], corr(), evt()),
      ).toThrow(ContactInvariantError);
    });

    it('SUPPRESSED contact cannot be validated', () => {
      const contact = Contact.discover(baseProps(), 'provider', corr(), evt());
      contact.suppress('opt-out', corr(), evt());
      expect(() => contact.validate(corr(), evt())).toThrow(ContactInvariantError);
    });

    it('SUPPRESSED contact cannot be verified', () => {
      const contact = Contact.discover(baseProps(), 'provider', corr(), evt());
      contact.suppress('opt-out', corr(), evt());
      expect(() => contact.verify(corr(), evt())).toThrow(ContactInvariantError);
    });

    it('SUPPRESSED contact cannot be markBounced', () => {
      const contact = Contact.discover(baseProps(), 'provider', corr(), evt());
      contact.suppress('opt-out', corr(), evt());
      expect(() => contact.markBounced(corr(), evt())).toThrow(ContactInvariantError);
    });

    it('preserves suppression reason', () => {
      const contact = Contact.discover(baseProps(), 'provider', corr(), evt());
      contact.suppress('gdpr-request', corr(), evt());
      expect(contact.suppressionReason).toBe('gdpr-request');
    });

    it('preserves suppression reference', () => {
      const contact = Contact.discover(baseProps(), 'provider', corr(), evt());
      contact.suppress('opt-out', corr(), evt(), 'ref-123');
      expect(contact.suppressionReference).toBe('ref-123');
    });

    it('records suppressedAt timestamp', () => {
      const contact = Contact.discover(baseProps(), 'provider', corr(), evt());
      contact.suppress('opt-out', corr(), evt());
      expect(contact.suppressedAt).toBeInstanceOf(Date);
    });

    it('SUPPRESSED contact is not outreach eligible', () => {
      const contact = Contact.discover(baseProps(), 'provider', corr(), evt());
      contact.suppress('opt-out', corr(), evt());
      expect(contact.isOutreachEligible()).toBe(false);
    });
  });

  describe('outreach eligibility', () => {
    it('BOUNCED contact is not outreach eligible', () => {
      const contact = Contact.discover(baseProps(), 'provider', corr(), evt());
      contact.markBounced(corr(), evt());
      expect(contact.isOutreachEligible()).toBe(false);
    });

    it('DISCOVERED contact is outreach eligible by default', () => {
      const contact = Contact.discover(baseProps(), 'provider', corr(), evt());
      expect(contact.isOutreachEligible()).toBe(true);
    });

    it('VERIFIED contact is outreach eligible', () => {
      const contact = Contact.discover(baseProps(), 'provider', corr(), evt());
      contact.verify(corr(), evt());
      expect(contact.isOutreachEligible()).toBe(true);
    });
  });

  describe('protected PII representation', () => {
    it('preserves emailFingerprint (synthetic)', () => {
      const contact = Contact.discover(
        baseProps({ emailFingerprint: 'hmac-email-001' }),
        'provider',
        corr(),
        evt(),
      );
      expect(contact.emailFingerprint).toBe('hmac-email-001');
    });

    it('preserves phoneFingerprint (synthetic)', () => {
      const contact = Contact.discover(
        baseProps({ phoneFingerprint: 'hmac-phone-001' }),
        'provider',
        corr(),
        evt(),
      );
      expect(contact.phoneFingerprint).toBe('hmac-phone-001');
    });

    it('preserves encryptedEmail (synthetic)', () => {
      const contact = Contact.discover(
        baseProps({ encryptedEmail: 'enc-email-001' }),
        'provider',
        corr(),
        evt(),
      );
      expect(contact.encryptedEmail).toBe('enc-email-001');
    });

    it('preserves encryptedPhone (synthetic)', () => {
      const contact = Contact.discover(
        baseProps({ encryptedPhone: 'enc-phone-001' }),
        'provider',
        corr(),
        evt(),
      );
      expect(contact.encryptedPhone).toBe('enc-phone-001');
    });

    it('protected fields default to undefined', () => {
      const contact = Contact.discover(baseProps(), 'provider', corr(), evt());
      expect(contact.emailFingerprint).toBeUndefined();
      expect(contact.encryptedEmail).toBeUndefined();
      expect(contact.phoneFingerprint).toBeUndefined();
      expect(contact.encryptedPhone).toBeUndefined();
    });

    it('ContactProps does not have email or phone fields', () => {
      const props = baseProps();
      expect('email' in props).toBe(false);
      expect('phone' in props).toBe(false);
    });
  });

  describe('existing lifecycle preservation', () => {
    it('discover → enrich → validate lifecycle', () => {
      const contact = Contact.discover(baseProps(), 'provider', corr(), evt());
      expect(contact.status).toBe('DISCOVERED');
      contact.enrich({ title: 'VP Sales' }, [asEvidenceId('ev-1')], corr(), evt());
      expect(contact.status).toBe('ENRICHED');
      contact.validate(corr(), evt());
      expect(contact.status).toBe('VALIDATED');
    });

    it('evidence references preserved across enrich', () => {
      const contact = Contact.discover(baseProps(), 'provider', corr(), evt());
      contact.enrich({}, [asEvidenceId('ev-1'), asEvidenceId('ev-2')], corr(), evt());
      expect(contact.evidenceReferences).toEqual(['ev-1', 'ev-2']);
    });

    it('suppress emits ContactSuppressed event', () => {
      const contact = Contact.discover(baseProps(), 'provider', corr(), evt());
      contact.suppress('opt-out', corr(), evt());
      expect(contact.domainEvents.some((e) => e.eventType === 'ContactSuppressed')).toBe(true);
    });
  });

  describe('reconstitute', () => {
    it('restores from snapshot with no domain events', () => {
      const contact = Contact.reconstitute(
        {
          ...baseProps(),
          status: 'ENRICHED',
          verificationState: 'VERIFIED',
          department: 'Engineering',
          functionRole: 'Technical Lead',
          emailFingerprint: 'hmac-email-001',
        },
        4,
      );
      expect(contact.status).toBe('ENRICHED');
      expect(contact.verificationState).toBe('VERIFIED');
      expect(contact.department).toBe('Engineering');
      expect(contact.functionRole).toBe('Technical Lead');
      expect(contact.emailFingerprint).toBe('hmac-email-001');
      expect(contact.version).toBe(4);
      expect(contact.domainEvents).toHaveLength(0);
    });

    it('reconstituted SUPPRESSED contact remains suppressed', () => {
      const contact = Contact.reconstitute(
        {
          ...baseProps(),
          status: 'SUPPRESSED',
          suppressionReason: 'gdpr',
          suppressedAt: new Date(),
        },
        2,
      );
      expect(contact.status).toBe('SUPPRESSED');
      expect(contact.suppressionReason).toBe('gdpr');
      expect(contact.isOutreachEligible()).toBe(false);
    });
  });
});
