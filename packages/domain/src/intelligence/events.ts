import type { CorrelationId, EventId, TenantId } from '@projectx/shared';
import { DomainEvent } from '../events/domain-event';
import type { AccountId, ContactId, EvidenceId, ICPProfileId, LeadId, ResearchRequestId } from '../types';

export class ICPProfileCreated extends DomainEvent<{
  profileId: ICPProfileId;
  name: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { profileId: ICPProfileId; name: string },
  ) {
    super(eventId, 'ICPProfileCreated', '1', new Date(), tenantId, correlationId, 'intelligence', payload);
  }
}

export class ICPProfileUpdated extends DomainEvent<{
  profileId: ICPProfileId;
  name: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { profileId: ICPProfileId; name: string },
  ) {
    super(eventId, 'ICPProfileUpdated', '1', new Date(), tenantId, correlationId, 'intelligence', payload);
  }
}

export class AccountDiscovered extends DomainEvent<{
  accountId: AccountId;
  name: string;
  source: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { accountId: AccountId; name: string; source: string },
  ) {
    super(eventId, 'AccountDiscovered', '1', new Date(), tenantId, correlationId, 'intelligence', payload);
  }
}

export class AccountEnriched extends DomainEvent<{
  accountId: AccountId;
  evidenceIds: EvidenceId[];
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { accountId: AccountId; evidenceIds: EvidenceId[] },
  ) {
    super(eventId, 'AccountEnriched', '1', new Date(), tenantId, correlationId, 'intelligence', payload);
  }
}

export class AccountMarkedDuplicate extends DomainEvent<{
  accountId: AccountId;
  canonicalAccountId: AccountId;
  reason: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { accountId: AccountId; canonicalAccountId: AccountId; reason: string },
  ) {
    super(eventId, 'AccountMarkedDuplicate', '1', new Date(), tenantId, correlationId, 'intelligence', payload);
  }
}

export class AccountDisqualified extends DomainEvent<{
  accountId: AccountId;
  reason: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { accountId: AccountId; reason: string },
  ) {
    super(eventId, 'AccountDisqualified', '1', new Date(), tenantId, correlationId, 'intelligence', payload);
  }
}

export class ContactDiscovered extends DomainEvent<{
  contactId: ContactId;
  accountId: AccountId;
  source: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { contactId: ContactId; accountId: AccountId; source: string },
  ) {
    super(eventId, 'ContactDiscovered', '1', new Date(), tenantId, correlationId, 'intelligence', payload);
  }
}

export class ContactEnriched extends DomainEvent<{
  contactId: ContactId;
  evidenceIds: EvidenceId[];
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { contactId: ContactId; evidenceIds: EvidenceId[] },
  ) {
    super(eventId, 'ContactEnriched', '1', new Date(), tenantId, correlationId, 'intelligence', payload);
  }
}

export class ContactValidated extends DomainEvent<{
  contactId: ContactId;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { contactId: ContactId },
  ) {
    super(eventId, 'ContactValidated', '1', new Date(), tenantId, correlationId, 'intelligence', payload);
  }
}

export class ContactSuppressed extends DomainEvent<{
  contactId: ContactId;
  reason: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { contactId: ContactId; reason: string },
  ) {
    super(eventId, 'ContactSuppressed', '1', new Date(), tenantId, correlationId, 'intelligence', payload);
  }
}

export class ResearchEvidenceCollected extends DomainEvent<{
  evidenceId: EvidenceId;
  accountId?: AccountId;
  contactId?: ContactId;
  claimType: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { evidenceId: EvidenceId; accountId?: AccountId; contactId?: ContactId; claimType: string },
  ) {
    super(eventId, 'ResearchEvidenceCollected', '1', new Date(), tenantId, correlationId, 'intelligence', payload);
  }
}

export class ResearchEvidenceContradicted extends DomainEvent<{
  evidenceId: EvidenceId;
  conflictingEvidenceId: EvidenceId;
  resolution: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { evidenceId: EvidenceId; conflictingEvidenceId: EvidenceId; resolution: string },
  ) {
    super(eventId, 'ResearchEvidenceContradicted', '1', new Date(), tenantId, correlationId, 'intelligence', payload);
  }
}

export class BuyingSignalDetected extends DomainEvent<{
  signalId: string;
  accountId: AccountId;
  signalType: string;
  score: number;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { signalId: string; accountId: AccountId; signalType: string; score: number },
  ) {
    super(eventId, 'BuyingSignalDetected', '1', new Date(), tenantId, correlationId, 'intelligence', payload);
  }
}

export class LeadQualified extends DomainEvent<{
  leadId: LeadId;
  accountId: AccountId;
  contactId: ContactId;
  score: number;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { leadId: LeadId; accountId: AccountId; contactId: ContactId; score: number },
  ) {
    super(eventId, 'LeadQualified', '1', new Date(), tenantId, correlationId, 'intelligence', payload);
  }
}

export class LeadDisqualified extends DomainEvent<{
  leadId: LeadId;
  accountId: AccountId;
  contactId: ContactId;
  reason: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { leadId: LeadId; accountId: AccountId; contactId: ContactId; reason: string },
  ) {
    super(eventId, 'LeadDisqualified', '1', new Date(), tenantId, correlationId, 'intelligence', payload);
  }
}

export class LeadRequiresReview extends DomainEvent<{
  leadId: LeadId;
  accountId: AccountId;
  contactId: ContactId;
  reason: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { leadId: LeadId; accountId: AccountId; contactId: ContactId; reason: string },
  ) {
    super(eventId, 'LeadRequiresReview', '1', new Date(), tenantId, correlationId, 'intelligence', payload);
  }
}

export class ResearchRequestSubmitted extends DomainEvent<{
  requestId: ResearchRequestId;
  missionId?: string;
  objective: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: { requestId: ResearchRequestId; missionId?: string; objective: string },
  ) {
    super(eventId, 'ResearchRequestSubmitted', '1', new Date(), tenantId, correlationId, 'intelligence', payload);
  }
}
