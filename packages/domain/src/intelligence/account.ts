import type { EventId, CorrelationId, TenantId, AccountId, EvidenceId } from '@projectx/shared';
import { AggregateRoot } from '../aggregate/aggregate-root';
import * as Events from './events';

export interface AccountProps {
  id?: AccountId;
  tenantId: TenantId;
  name: string;
  domain?: string;
  aliases?: string[];
  industry?: string;
  employeeCount?: number;
  annualRevenueUsd?: number;
  territories?: string[];
  techStack?: string[];
  status?: AccountStatus;
  duplicateOf?: AccountId;
  evidenceReferences?: EvidenceId[];
  createdAt?: Date;
  updatedAt?: Date;
}

export type AccountStatus = 'DISCOVERED' | 'ENRICHED' | 'QUALIFIED' | 'DISQUALIFIED' | 'DUPLICATE';

export class Account extends AggregateRoot<AccountId> {
  public name: string;
  public domain?: string;
  public aliases: string[];
  public industry?: string;
  public employeeCount?: number;
  public annualRevenueUsd?: number;
  public territories: string[];
  public techStack: string[];
  public status: AccountStatus;
  public duplicateOf?: AccountId;
  public readonly evidenceReferences: EvidenceId[];
  public readonly createdAt: Date;
  public updatedAt: Date;

  private constructor(props: AccountProps) {
    super(props.tenantId, props.id!);
    this.name = props.name;
    this.domain = props.domain;
    this.aliases = props.aliases ?? [];
    this.industry = props.industry;
    this.employeeCount = props.employeeCount;
    this.annualRevenueUsd = props.annualRevenueUsd;
    this.territories = props.territories ?? [];
    this.techStack = props.techStack ?? [];
    this.status = props.status ?? 'DISCOVERED';
    this.duplicateOf = props.duplicateOf;
    this.evidenceReferences = props.evidenceReferences ?? [];
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? new Date();
  }

  static create(
    props: AccountProps,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Account {
    const account = new Account(props);
    account.applyEvent(
      new Events.AccountDiscovered(eventId, props.tenantId, correlationId, {
        accountId: account.id,
        name: account.name,
        source: 'manual',
      }),
    );
    return account;
  }

  static discover(
    props: AccountProps,
    source: string,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Account {
    const account = new Account({ ...props, status: 'DISCOVERED' });
    account.applyEvent(
      new Events.AccountDiscovered(eventId, props.tenantId, correlationId, {
        accountId: account.id,
        name: account.name,
        source,
      }),
    );
    return account;
  }

  enrich(updates: Partial<Omit<AccountProps, 'id' | 'tenantId'>>, evidenceIds: EvidenceId[], correlationId: CorrelationId, eventId: EventId): void {
    Object.assign(this, updates);
    this.evidenceReferences.push(...evidenceIds);
    this.status = 'ENRICHED';
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.AccountEnriched(eventId, this.tenantId, correlationId, {
        accountId: this.id,
        evidenceIds,
      }),
    );
  }

  markDuplicate(canonicalAccountId: AccountId, reason: string, correlationId: CorrelationId, eventId: EventId): void {
    this.status = 'DUPLICATE';
    this.duplicateOf = canonicalAccountId;
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.AccountMarkedDuplicate(eventId, this.tenantId, correlationId, {
        accountId: this.id,
        canonicalAccountId,
        reason,
      }),
    );
  }

  disqualify(reason: string, correlationId: CorrelationId, eventId: EventId): void {
    this.status = 'DISQUALIFIED';
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.AccountDisqualified(eventId, this.tenantId, correlationId, {
        accountId: this.id,
        reason,
      }),
    );
  }

  qualify(correlationId: CorrelationId, eventId: EventId): void {
    this.status = 'QUALIFIED';
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.AccountEnriched(eventId, this.tenantId, correlationId, {
        accountId: this.id,
        evidenceIds: [],
      }),
    );
  }
}
