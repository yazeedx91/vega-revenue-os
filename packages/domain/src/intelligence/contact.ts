import type { EventId, CorrelationId, TenantId, AccountId, ContactId, EvidenceId } from '@projectx/shared';
import { AggregateRoot } from '../aggregate/aggregate-root';
import * as Events from './events';

export const VERIFICATION_STATES = ['UNVERIFIED', 'VERIFIED', 'BOUNCED'] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

export interface ContactProps {
  id?: ContactId;
  tenantId: TenantId;
  workspaceId: string;
  accountId: AccountId;
  name?: string;
  title?: string;
  role?: string;
  seniority?: string;
  department?: string;
  functionRole?: string;
  emailFingerprint?: string;
  encryptedEmail?: string;
  phoneFingerprint?: string;
  encryptedPhone?: string;
  linkedInUrl?: string;
  channels?: string[];
  consentStatus?: 'GRANTED' | 'WITHHELD' | 'UNKNOWN';
  verificationState?: VerificationState;
  status?: ContactStatus;
  suppressionReason?: string;
  suppressionReference?: string;
  suppressedAt?: Date;
  evidenceReferences?: EvidenceId[];
  createdAt?: Date;
  updatedAt?: Date;
}

export type ContactStatus = 'DISCOVERED' | 'ENRICHED' | 'VALIDATED' | 'SUPPRESSED';

export class ContactInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContactInvariantError';
  }
}

export class Contact extends AggregateRoot<ContactId> {
  public readonly workspaceId: string;
  public accountId: AccountId;
  public name?: string;
  public title?: string;
  public role?: string;
  public seniority?: string;
  public department?: string;
  public functionRole?: string;
  public emailFingerprint?: string;
  public encryptedEmail?: string;
  public phoneFingerprint?: string;
  public encryptedPhone?: string;
  public linkedInUrl?: string;
  public channels: string[];
  public consentStatus: 'GRANTED' | 'WITHHELD' | 'UNKNOWN';
  public verificationState: VerificationState;
  public status: ContactStatus;
  public suppressionReason?: string;
  public suppressionReference?: string;
  public suppressedAt?: Date;
  public readonly evidenceReferences: EvidenceId[];
  public readonly createdAt: Date;
  public updatedAt: Date;

  private constructor(props: ContactProps) {
    super(props.tenantId, props.id!);
    this.workspaceId = props.workspaceId;
    this.accountId = props.accountId;
    this.name = props.name;
    this.title = props.title;
    this.role = props.role;
    this.seniority = props.seniority;
    this.department = props.department;
    this.functionRole = props.functionRole;
    this.emailFingerprint = props.emailFingerprint;
    this.encryptedEmail = props.encryptedEmail;
    this.phoneFingerprint = props.phoneFingerprint;
    this.encryptedPhone = props.encryptedPhone;
    this.linkedInUrl = props.linkedInUrl;
    this.channels = props.channels ?? [];
    this.consentStatus = props.consentStatus ?? 'UNKNOWN';
    this.verificationState = props.verificationState ?? 'UNVERIFIED';
    this.status = props.status ?? 'DISCOVERED';
    this.suppressionReason = props.suppressionReason;
    this.suppressionReference = props.suppressionReference;
    this.suppressedAt = props.suppressedAt;
    this.evidenceReferences = props.evidenceReferences ?? [];
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? new Date();
  }

  private assertNotSuppressed(): void {
    if (this.status === 'SUPPRESSED') {
      throw new ContactInvariantError('Cannot modify a SUPPRESSED contact');
    }
  }

  static discover(
    props: ContactProps,
    source: string,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Contact {
    const contact = new Contact({ ...props, status: 'DISCOVERED' });
    contact.applyEvent(
      new Events.ContactDiscovered(eventId, props.tenantId, correlationId, {
        contactId: contact.id,
        accountId: contact.accountId,
        source,
      }),
    );
    return contact;
  }

  static reconstitute(props: ContactProps, aggregateVersion: number): Contact {
    const contact = new Contact(props);
    contact.setVersion(aggregateVersion);
    contact.clearDomainEvents();
    return contact;
  }

  enrich(updates: Partial<Omit<ContactProps, 'id' | 'tenantId' | 'workspaceId' | 'accountId'>>, evidenceIds: EvidenceId[], correlationId: CorrelationId, eventId: EventId): void {
    this.assertNotSuppressed();
    Object.assign(this, updates);
    this.evidenceReferences.push(...evidenceIds);
    if (this.status === 'DISCOVERED') {
      this.status = 'ENRICHED';
    }
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.ContactEnriched(eventId, this.tenantId, correlationId, {
        contactId: this.id,
        evidenceIds,
      }),
    );
  }

  validate(correlationId: CorrelationId, eventId: EventId): void {
    this.assertNotSuppressed();
    this.status = 'VALIDATED';
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.ContactValidated(eventId, this.tenantId, correlationId, {
        contactId: this.id,
      }),
    );
  }

  verify(correlationId: CorrelationId, eventId: EventId): void {
    this.assertNotSuppressed();
    this.verificationState = 'VERIFIED';
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.ContactValidated(eventId, this.tenantId, correlationId, {
        contactId: this.id,
      }),
    );
  }

  markBounced(correlationId: CorrelationId, eventId: EventId): void {
    this.assertNotSuppressed();
    this.verificationState = 'BOUNCED';
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.ContactValidated(eventId, this.tenantId, correlationId, {
        contactId: this.id,
      }),
    );
  }

  suppress(reason: string, correlationId: CorrelationId, eventId: EventId, reference?: string): void {
    this.status = 'SUPPRESSED';
    this.suppressionReason = reason;
    this.suppressionReference = reference;
    this.suppressedAt = new Date();
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.ContactSuppressed(eventId, this.tenantId, correlationId, {
        contactId: this.id,
        reason,
      }),
    );
  }

  isOutreachEligible(): boolean {
    if (this.status === 'SUPPRESSED') return false;
    if (this.verificationState === 'BOUNCED') return false;
    return true;
  }
}
