import type { EventId, CorrelationId, TenantId, AccountId, ContactId, EvidenceId } from '@projectx/shared';
import { AggregateRoot } from '../aggregate/aggregate-root';
import * as Events from './events';

export interface ContactProps {
  id?: ContactId;
  tenantId: TenantId;
  accountId: AccountId;
  name?: string;
  title?: string;
  role?: string;
  seniority?: string;
  email?: string;
  phone?: string;
  linkedInUrl?: string;
  channels?: string[];
  consentStatus?: 'GRANTED' | 'WITHHELD' | 'UNKNOWN';
  status?: ContactStatus;
  evidenceReferences?: EvidenceId[];
  createdAt?: Date;
  updatedAt?: Date;
}

export type ContactStatus = 'DISCOVERED' | 'ENRICHED' | 'VALIDATED' | 'SUPPRESSED';

export class Contact extends AggregateRoot<ContactId> {
  public accountId: AccountId;
  public name?: string;
  public title?: string;
  public role?: string;
  public seniority?: string;
  public email?: string;
  public phone?: string;
  public linkedInUrl?: string;
  public channels: string[];
  public consentStatus: 'GRANTED' | 'WITHHELD' | 'UNKNOWN';
  public status: ContactStatus;
  public readonly evidenceReferences: EvidenceId[];
  public readonly createdAt: Date;
  public updatedAt: Date;

  private constructor(props: ContactProps) {
    super(props.tenantId, props.id!);
    this.accountId = props.accountId;
    this.name = props.name;
    this.title = props.title;
    this.role = props.role;
    this.seniority = props.seniority;
    this.email = props.email;
    this.phone = props.phone;
    this.linkedInUrl = props.linkedInUrl;
    this.channels = props.channels ?? [];
    this.consentStatus = props.consentStatus ?? 'UNKNOWN';
    this.status = props.status ?? 'DISCOVERED';
    this.evidenceReferences = props.evidenceReferences ?? [];
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? new Date();
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

  enrich(updates: Partial<Omit<ContactProps, 'id' | 'tenantId' | 'accountId'>>, evidenceIds: EvidenceId[], correlationId: CorrelationId, eventId: EventId): void {
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
    this.status = 'VALIDATED';
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.ContactValidated(eventId, this.tenantId, correlationId, {
        contactId: this.id,
      }),
    );
  }

  suppress(reason: string, correlationId: CorrelationId, eventId: EventId): void {
    this.status = 'SUPPRESSED';
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.ContactSuppressed(eventId, this.tenantId, correlationId, {
        contactId: this.id,
        reason,
      }),
    );
  }
}
