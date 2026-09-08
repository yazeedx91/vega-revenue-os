import type { EventId, CorrelationId, TenantId, AccountId, EvidenceId } from '@projectx/shared';
import { AggregateRoot } from '../aggregate/aggregate-root';
import * as Events from './events';

export const COMPANY_SIZE_BANDS = ['STARTUP', 'SMB', 'MID_MARKET', 'ENTERPRISE'] as const;
export type CompanySizeBand = (typeof COMPANY_SIZE_BANDS)[number];

export const ENRICHMENT_STATES = ['NONE', 'PARTIAL', 'COMPLETE'] as const;
export type EnrichmentState = (typeof ENRICHMENT_STATES)[number];

export interface AccountProps {
  id?: AccountId;
  tenantId: TenantId;
  workspaceId: string;
  name: string;
  domain?: string;
  normalizedDomain?: string;
  aliases?: string[];
  industry?: string;
  geography?: string;
  companySizeBand?: CompanySizeBand;
  employeeCount?: number;
  annualRevenueUsd?: number;
  territories?: string[];
  techStack?: string[];
  enrichmentState?: EnrichmentState;
  status?: AccountStatus;
  duplicateOf?: AccountId;
  evidenceReferences?: EvidenceId[];
  accountVersion?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export type AccountStatus = 'DISCOVERED' | 'ENRICHED' | 'QUALIFIED' | 'DISQUALIFIED' | 'DUPLICATE';

export class AccountInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountInvariantError';
  }
}

export class Account extends AggregateRoot<AccountId> {
  public readonly workspaceId: string;
  public name: string;
  public domain?: string;
  public normalizedDomain?: string;
  public aliases: string[];
  public industry?: string;
  public geography?: string;
  public companySizeBand?: CompanySizeBand;
  public employeeCount?: number;
  public annualRevenueUsd?: number;
  public territories: string[];
  public techStack: string[];
  public enrichmentState: EnrichmentState;
  public status: AccountStatus;
  public duplicateOf?: AccountId;
  public readonly evidenceReferences: EvidenceId[];
  public accountVersion: number;
  public readonly createdAt: Date;
  public updatedAt: Date;

  private constructor(props: AccountProps) {
    super(props.tenantId, props.id!);
    this.workspaceId = props.workspaceId;
    this.name = props.name;
    this.domain = props.domain;
    this.normalizedDomain = props.normalizedDomain ?? Account.normalizeDomain(props.domain);
    this.aliases = props.aliases ?? [];
    this.industry = props.industry;
    this.geography = props.geography;
    this.companySizeBand = props.companySizeBand;
    this.employeeCount = props.employeeCount;
    this.annualRevenueUsd = props.annualRevenueUsd;
    this.territories = props.territories ?? [];
    this.techStack = props.techStack ?? [];
    this.enrichmentState = props.enrichmentState ?? 'NONE';
    this.status = props.status ?? 'DISCOVERED';
    this.duplicateOf = props.duplicateOf;
    this.evidenceReferences = props.evidenceReferences ?? [];
    this.accountVersion = props.accountVersion ?? 1;
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? new Date();
  }

  private static validateAccountVersion(v: number): AccountInvariantError | null {
    if (!Number.isFinite(v) || !Number.isInteger(v) || v < 1) {
      return new AccountInvariantError('accountVersion must be a positive integer >= 1');
    }
    return null;
  }

  static normalizeDomain(raw: string | undefined | null): string | undefined {
    if (raw == null || raw.trim().length === 0) return undefined;
    let cleaned = raw.trim().toLowerCase();
    // Remove scheme
    const schemeIdx = cleaned.indexOf('://');
    if (schemeIdx !== -1) {
      cleaned = cleaned.slice(schemeIdx + 3);
    }
    // Remove path/query/fragment
    const pathIdx = cleaned.indexOf('/');
    if (pathIdx !== -1) cleaned = cleaned.slice(0, pathIdx);
    const queryIdx = cleaned.indexOf('?');
    if (queryIdx !== -1) cleaned = cleaned.slice(0, queryIdx);
    const fragIdx = cleaned.indexOf('#');
    if (fragIdx !== -1) cleaned = cleaned.slice(0, fragIdx);
    // Remove port
    const portIdx = cleaned.lastIndexOf(':');
    if (portIdx !== -1) cleaned = cleaned.slice(0, portIdx);
    // Remove trailing dot
    if (cleaned.endsWith('.')) cleaned = cleaned.slice(0, -1);
    // Remove one leading www.
    if (cleaned.startsWith('www.')) cleaned = cleaned.slice(4);
    return cleaned.length > 0 ? cleaned : undefined;
  }

  computeDedupIdentity(): string | undefined {
    if (!this.normalizedDomain) return undefined;
    return `${this.tenantId}:${this.workspaceId}:${this.normalizedDomain}`;
  }

  private incrementVersion(): void {
    this.accountVersion += 1;
  }

  static create(
    props: AccountProps,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Account {
    const vErr = Account.validateAccountVersion(props.accountVersion ?? 1);
    if (vErr) throw vErr;
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
    const vErr = Account.validateAccountVersion(props.accountVersion ?? 1);
    if (vErr) throw vErr;
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

  static reconstitute(props: AccountProps, aggregateVersion: number): Account {
    const account = new Account(props);
    account.setVersion(aggregateVersion);
    account.clearDomainEvents();
    return account;
  }

  enrich(updates: Partial<Omit<AccountProps, 'id' | 'tenantId' | 'workspaceId' | 'accountVersion'>>, evidenceIds: EvidenceId[], correlationId: CorrelationId, eventId: EventId): void {
    if (updates.domain !== undefined && updates.domain !== this.domain) {
      updates = { ...updates, normalizedDomain: Account.normalizeDomain(updates.domain) };
    }
    Object.assign(this, updates);
    this.evidenceReferences.push(...evidenceIds);
    this.status = 'ENRICHED';
    this.updatedAt = new Date();
    this.incrementVersion();
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
    this.incrementVersion();
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
    this.incrementVersion();
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
    this.incrementVersion();
    this.applyEvent(
      new Events.AccountEnriched(eventId, this.tenantId, correlationId, {
        accountId: this.id,
        evidenceIds: [],
      }),
    );
  }
}
