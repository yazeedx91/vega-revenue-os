import type { DomainError, Result } from '@projectx/shared';
import type { CommandContext } from '../commands/command-context';

export interface IQueryHandler<TQuery, TResult> {
  execute(ctx: CommandContext, query: TQuery): Promise<Result<TResult, DomainError>>;
}
