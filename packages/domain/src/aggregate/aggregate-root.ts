import type { TenantId } from '@projectx/shared';
import type { DomainEvent } from '../events/domain-event';

/**
 * Minimal DDD aggregate root base class.
 * Tracks domain events for eventual publishing and a version for optimistic concurrency.
 */
export abstract class AggregateRoot<TId extends string = string> {
  private _version = 0;
  private _loadedVersion: number | undefined;
  private readonly _domainEvents: DomainEvent<unknown>[] = [];

  protected constructor(
    public readonly tenantId: TenantId,
    public readonly id: TId,
  ) {}

  get version(): number {
    return this._version;
  }

  /**
   * The version this aggregate had when it was loaded/reconstituted from
   * persistence, fixed regardless of subsequent applyEvent() calls.
   * `undefined` for a freshly created aggregate that has never been persisted.
   * Repositories use this as the optimistic-concurrency compare-and-swap key.
   */
  get loadedVersion(): number | undefined {
    return this._loadedVersion;
  }

  get domainEvents(): readonly DomainEvent<unknown>[] {
    return this._domainEvents;
  }

  protected applyEvent<TPayload>(event: DomainEvent<TPayload>): void {
    this._domainEvents.push(event);
    this._version += 1;
  }

  public clearDomainEvents(): void {
    this._domainEvents.length = 0;
  }

  /**
   * Sets the current version to the value loaded from persistence and
   * records it as the loadedVersion baseline for optimistic concurrency.
   * Must only be called during reconstitution, before any applyEvent() calls.
   */
  public setVersion(version: number): void {
    this._version = version;
    this._loadedVersion = version;
  }
}
