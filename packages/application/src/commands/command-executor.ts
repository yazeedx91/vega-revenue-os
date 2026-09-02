import type { DomainError, Result } from '@projectx/shared';
import type { IAuditLog } from '../ports/audit-log';
import type { IEventPublisher } from '../ports/event-publisher';
import type { IIdempotencyStore } from '../ports/idempotency-store';
import type { ITelemetry } from '@projectx/infrastructure';
import type { CommandContext } from './command-context';
import type { CommandOutcome, ICommandHandler } from './command-handler';

export interface CommandExecutorOptions {
  readonly idempotent?: boolean;
  readonly idempotencyScope?: string;
  readonly auditAction?: string;
  readonly telemetryName?: string;
}

export interface CommandExecutorDependencies {
  readonly telemetry: ITelemetry;
  readonly auditLog: IAuditLog;
  readonly idempotencyStore: IIdempotencyStore;
  readonly eventPublisher: IEventPublisher;
}

export class CommandExecutor {
  constructor(private readonly deps: CommandExecutorDependencies) {}

  async execute<TCommand, TResult>(
    ctx: CommandContext,
    command: TCommand,
    handler: ICommandHandler<TCommand, TResult>,
    options: CommandExecutorOptions = {},
  ): Promise<Result<CommandOutcome<TResult>, DomainError>> {
    const telemetryName = options.telemetryName ?? `command.${handler.constructor.name}`;
    return this.deps.telemetry.span(telemetryName, async () => {
      const scope = options.idempotencyScope ?? handler.constructor.name;
      if (options.idempotent && ctx.idempotencyKey) {
        const cached = await this.deps.idempotencyStore.get<CommandOutcome<TResult>>(
          ctx,
          scope,
          ctx.idempotencyKey,
        );
        if (cached) {
          return { success: true as const, value: cached.result };
        }
      }

      const result = await handler.execute(ctx, command);

      if (result.success) {
        await this.deps.eventPublisher.publish(result.value.domainEvents);
        if (options.idempotent && ctx.idempotencyKey) {
          await this.deps.idempotencyStore.set(ctx, scope, ctx.idempotencyKey, result.value);
        }
      }

      await this.deps.auditLog.record(ctx, {
        action: options.auditAction ?? telemetryName,
        resourceType: result.success ? result.value.resourceType : 'command',
        resourceId: result.success ? result.value.resourceId : 'unknown',
        result: result.success ? 'success' : 'denied',
        reason: result.success ? undefined : result.error.code,
      });

      return result;
    });
  }
}
