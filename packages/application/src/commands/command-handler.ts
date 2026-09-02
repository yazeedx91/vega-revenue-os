import type { DomainEvent } from '@projectx/domain';
import { ok, type DomainError, type Result } from '@projectx/shared';
import type { CommandContext } from './command-context';

export interface CommandOutcome<TResult> {
  readonly value: TResult;
  readonly domainEvents: readonly DomainEvent<unknown>[];
  readonly resourceType: string;
  readonly resourceId: string;
}

export interface ICommandHandler<TCommand, TResult> {
  execute(ctx: CommandContext, command: TCommand): Promise<Result<CommandOutcome<TResult>, DomainError>>;
}

export function okOutcome<T>(
  value: T,
  resourceType: string,
  resourceId: string,
): CommandOutcome<T> {
  return {
    value,
    domainEvents: value && typeof value === 'object' && 'domainEvents' in value
      ? (value as { domainEvents: readonly DomainEvent<unknown>[] }).domainEvents
      : [],
    resourceType,
    resourceId,
  };
}

export { ok, type Result, type DomainError };
