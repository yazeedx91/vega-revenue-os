import type { EventId, CorrelationId, TenantId, ContractId, SubscriptionId, EvidenceId } from '@projectx/shared';
import { AggregateRoot } from '../aggregate/aggregate-root';
import { MonetaryAmount } from './value-objects/monetary-amount';
import * as Events from './events/subscription-events';

export type SubscriptionStatus = 'ACTIVE' | 'PAUSED' | 'CHURNED' | 'EXPIRED';

export interface SubscriptionProps {
  id?: SubscriptionId;
  tenantId: TenantId;
  workspaceId: string;
  contractId: ContractId;
  mrr?: MonetaryAmount;
  billingTerm?: string;
  status?: SubscriptionStatus;
  evidenceIds?: EvidenceId[];
  createdAt?: Date;
  updatedAt?: Date;
}

export class SubscriptionInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubscriptionInvariantError';
  }
}

export class Subscription extends AggregateRoot<SubscriptionId> {
  public readonly workspaceId: string;
  public readonly contractId: ContractId;
  public mrr: MonetaryAmount | undefined;
  public billingTerm: string | undefined;
  private _status: SubscriptionStatus;
  public readonly evidenceIds: EvidenceId[];
  public readonly createdAt: Date;
  public updatedAt: Date;

  get status(): SubscriptionStatus {
    return this._status;
  }

  private constructor(props: SubscriptionProps) {
    super(props.tenantId, props.id!);
    this.workspaceId = props.workspaceId;
    this.contractId = props.contractId;
    this.mrr = props.mrr;
    this.billingTerm = props.billingTerm;
    this._status = props.status ?? 'ACTIVE';
    this.evidenceIds = props.evidenceIds ?? [];
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? new Date();
  }

  static create(
    props: SubscriptionProps,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Subscription {
    if (!props.workspaceId || props.workspaceId.trim().length === 0) {
      throw new SubscriptionInvariantError('Workspace ID is required');
    }
    const subscription = new Subscription({ ...props, status: props.status ?? 'ACTIVE' });
    subscription.applyEvent(
      new Events.SubscriptionStarted(eventId, props.tenantId, correlationId, {
        subscriptionId: subscription.id,
        contractId: subscription.contractId,
        status: subscription._status,
      }),
    );
    return subscription;
  }

  static reconstitute(props: SubscriptionProps, version: number): Subscription {
    const subscription = new Subscription(props);
    subscription.setVersion(version);
    subscription.clearDomainEvents();
    return subscription;
  }

  pause(reason: string, correlationId: CorrelationId, eventId: EventId): void {
    this._status = 'PAUSED';
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.SubscriptionExpanded(eventId, this.tenantId, correlationId, {
        subscriptionId: this.id,
        contractId: this.contractId,
        reason,
      }),
    );
  }

  resume(correlationId: CorrelationId, eventId: EventId): void {
    this._status = 'ACTIVE';
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.SubscriptionExpanded(eventId, this.tenantId, correlationId, {
        subscriptionId: this.id,
        contractId: this.contractId,
        reason: 'Resumed',
      }),
    );
  }

  churn(reason: string, correlationId: CorrelationId, eventId: EventId): void {
    this._status = 'CHURNED';
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.SubscriptionChurned(eventId, this.tenantId, correlationId, {
        subscriptionId: this.id,
        contractId: this.contractId,
        reason,
      }),
    );
  }

  expire(correlationId: CorrelationId, eventId: EventId): void {
    this._status = 'EXPIRED';
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.SubscriptionChurned(eventId, this.tenantId, correlationId, {
        subscriptionId: this.id,
        contractId: this.contractId,
        reason: 'Expired',
      }),
    );
  }

  expand(newMRR: MonetaryAmount, correlationId: CorrelationId, eventId: EventId): void {
    this.mrr = newMRR;
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.SubscriptionExpanded(eventId, this.tenantId, correlationId, {
        subscriptionId: this.id,
        contractId: this.contractId,
        reason: 'Expanded',
      }),
    );
  }

  updateMRR(mrr: MonetaryAmount, correlationId: CorrelationId, eventId: EventId): void {
    this.mrr = mrr;
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.SubscriptionExpanded(eventId, this.tenantId, correlationId, {
        subscriptionId: this.id,
        contractId: this.contractId,
        reason: 'MRR updated',
      }),
    );
  }

  isActive(): boolean {
    return this._status === 'ACTIVE';
  }

  isPaused(): boolean {
    return this._status === 'PAUSED';
  }

  isChurned(): boolean {
    return this._status === 'CHURNED';
  }

  isExpired(): boolean {
    return this._status === 'EXPIRED';
  }
}