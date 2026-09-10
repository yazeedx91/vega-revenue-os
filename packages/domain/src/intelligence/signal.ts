import type { EventId, CorrelationId, TenantId, AccountId, ContactId, EvidenceId, SignalId } from '@projectx/shared';
import { AggregateRoot } from '../aggregate/aggregate-root';
import * as Events from './events';

export const SIGNAL_CATEGORIES = [
  'Growth',
  'Funding',
  'Leadership',
  'Technology',
  'DigitalTransformation',
  'BusinessChange',
  'PainIndicators',
  'CompetitivePressure',
  'IndustryTailwinds',
] as const;

export type SignalCategory = (typeof SIGNAL_CATEGORIES)[number];

export type SignalStatus = 'ACTIVE' | 'EXPIRED' | 'RETRACTED';

export const MAX_SIGNAL_SOURCE_LENGTH = 512;
export const MAX_SIGNAL_SOURCE_URI_LENGTH = 2048;
export const MAX_OBSERVED_SIGNAL_LENGTH = 4096;
export const MAX_INTERPRETED_SIGNAL_LENGTH = 4096;

export interface SignalProps {
  id: SignalId;
  tenantId: TenantId;
  workspaceId: string;
  accountId: AccountId;
  contactId?: ContactId;
  signalType: SignalCategory;
  observedAt: Date;
  effectiveFrom: Date;
  effectiveUntil: Date;
  source: string;
  sourceUri?: string;
  confidence: number;
  relevance: number;
  observedSignal: string;
  interpretedSignal: string;
  evidenceIds?: EvidenceId[];
  status?: SignalStatus;
  dedupIdentity?: string;
  createdAt?: Date;
}

export class SignalInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignalInvariantError';
  }
}

export class Signal extends AggregateRoot<SignalId> {
  public readonly workspaceId: string;
  public readonly accountId: AccountId;
  public readonly contactId?: ContactId;
  public readonly signalType: SignalCategory;
  public readonly observedAt: Date;
  public readonly effectiveFrom: Date;
  public readonly effectiveUntil: Date;
  public readonly source: string;
  public readonly sourceUri?: string;
  public readonly confidence: number;
  public readonly relevance: number;
  public readonly observedSignal: string;
  public readonly interpretedSignal: string;
  public readonly evidenceIds: EvidenceId[];
  public status: SignalStatus;
  public readonly dedupIdentity: string;
  public readonly createdAt: Date;

  private constructor(props: SignalProps) {
    super(props.tenantId, props.id);
    this.workspaceId = props.workspaceId;
    this.accountId = props.accountId;
    this.contactId = props.contactId;
    this.signalType = props.signalType;
    this.observedAt = props.observedAt;
    this.effectiveFrom = props.effectiveFrom;
    this.effectiveUntil = props.effectiveUntil;
    this.source = props.source;
    this.sourceUri = props.sourceUri;
    this.confidence = props.confidence;
    this.relevance = props.relevance;
    this.observedSignal = props.observedSignal;
    this.interpretedSignal = props.interpretedSignal;
    this.evidenceIds = props.evidenceIds ?? [];
    this.status = props.status ?? 'ACTIVE';
    this.dedupIdentity = props.dedupIdentity ?? Signal.computeDedupIdentity(props);
    this.createdAt = props.createdAt ?? new Date();
  }

  static computeDedupIdentity(props: Pick<SignalProps, 'tenantId' | 'workspaceId' | 'accountId' | 'signalType' | 'observedSignal'>): string {
    const normalizedSignal = props.observedSignal.trim().replace(/\s+/g, ' ').toLowerCase();
    return `${props.tenantId}:${props.workspaceId}:${props.accountId}:${props.signalType}:${Signal.hashString(normalizedSignal)}`;
  }

  private static hashString(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const chr = input.charCodeAt(i);
      hash = ((hash << 5) - hash + chr) | 0;
    }
    return Math.abs(hash).toString(36);
  }

  static detect(
    props: SignalProps,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Signal {
    if (props.confidence < 0 || props.confidence > 1) {
      throw new SignalInvariantError('Signal confidence must be between 0 and 1');
    }
    if (props.relevance < 0 || props.relevance > 1) {
      throw new SignalInvariantError('Signal relevance must be between 0 and 1');
    }
    if (!props.workspaceId) {
      throw new SignalInvariantError('workspaceId is required');
    }
    if (!props.source || props.source.length > MAX_SIGNAL_SOURCE_LENGTH) {
      throw new SignalInvariantError(`source must be non-empty and at most ${MAX_SIGNAL_SOURCE_LENGTH} characters`);
    }
    if (props.sourceUri && props.sourceUri.length > MAX_SIGNAL_SOURCE_URI_LENGTH) {
      throw new SignalInvariantError(`sourceUri must be at most ${MAX_SIGNAL_SOURCE_URI_LENGTH} characters`);
    }
    if (!props.observedSignal || props.observedSignal.trim().length === 0 || props.observedSignal.length > MAX_OBSERVED_SIGNAL_LENGTH) {
      throw new SignalInvariantError(`observedSignal must be non-empty and at most ${MAX_OBSERVED_SIGNAL_LENGTH} characters`);
    }
    if (!props.interpretedSignal || props.interpretedSignal.trim().length === 0 || props.interpretedSignal.length > MAX_INTERPRETED_SIGNAL_LENGTH) {
      throw new SignalInvariantError(`interpretedSignal must be non-empty and at most ${MAX_INTERPRETED_SIGNAL_LENGTH} characters`);
    }
    if (!SIGNAL_CATEGORIES.includes(props.signalType)) {
      throw new SignalInvariantError(`Invalid signal category: ${props.signalType}`);
    }
    if ([props.observedAt, props.effectiveFrom, props.effectiveUntil].some((value) => !(value instanceof Date) || Number.isNaN(value.getTime()))) {
      throw new SignalInvariantError('Signal timestamps must be valid dates');
    }
    if (props.effectiveUntil.getTime() <= props.effectiveFrom.getTime()) {
      throw new SignalInvariantError('effectiveUntil must be after effectiveFrom');
    }

    const signal = new Signal({ ...props, status: 'ACTIVE' });
    signal.applyEvent(
      new Events.SignalDetected(eventId, props.tenantId, correlationId, {
        signalId: signal.id,
        accountId: signal.accountId,
        signalType: signal.signalType,
        confidence: signal.confidence,
        relevance: signal.relevance,
      }),
    );
    return signal;
  }

  static reconstitute(snapshot: SignalProps, version: number): Signal {
    const signal = new Signal(snapshot);
    signal.setVersion(version);
    signal.clearDomainEvents();
    return signal;
  }

  isActive(at: Date = new Date()): boolean {
    return this.status === 'ACTIVE' && at.getTime() < this.effectiveUntil.getTime();
  }

  isExpired(at: Date = new Date()): boolean {
    return this.status === 'ACTIVE' && at.getTime() >= this.effectiveUntil.getTime();
  }

  expire(correlationId: CorrelationId, eventId: EventId): void {
    if (this.status !== 'ACTIVE') return;
    this.status = 'EXPIRED';
    this.applyEvent(
      new Events.SignalExpired(eventId, this.tenantId, correlationId, {
        signalId: this.id,
        accountId: this.accountId,
        signalType: this.signalType,
      }),
    );
  }

  retract(reason: string, correlationId: CorrelationId, eventId: EventId): void {
    if (this.status === 'RETRACTED') return;
    this.status = 'RETRACTED';
    this.applyEvent(
      new Events.SignalRetracted(eventId, this.tenantId, correlationId, {
        signalId: this.id,
        accountId: this.accountId,
        reason,
      }),
    );
  }
}
