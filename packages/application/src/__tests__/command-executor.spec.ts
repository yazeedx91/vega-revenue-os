import { Actor, type DomainEvent } from '@projectx/domain';
import { asCorrelationId, asEventId, asIdempotencyKey, asTenantId, ok } from '@projectx/shared';
import { CommandExecutor } from '../commands/command-executor';
import { okOutcome, type CommandOutcome, type ICommandHandler } from '../commands/command-handler';
import type { CommandContext } from '../commands/command-context';
import { InMemoryAuditLog } from '../test-doubles/audit-log';
import { CollectingEventPublisher } from '../test-doubles/event-publisher';
import { InMemoryIdempotencyStore } from '../test-doubles/idempotency-store';
import { NoOpTelemetry } from '../test-doubles/telemetry';

interface TestCommand {
  name: string;
}

class TestHandler implements ICommandHandler<TestCommand, string> {
  constructor(private readonly resultValue: string) {}

  async execute(
    _ctx: CommandContext,
    command: TestCommand,
  ): Promise<{ success: true; value: CommandOutcome<string> }> {
    const event: DomainEvent<unknown> = {
      eventId: asEventId('evt-1'),
      eventType: 'TestCommandExecuted',
      eventVersion: '1.0.0',
      occurredAt: new Date(),
      tenantId: asTenantId('tenant-1'),
      correlationId: asCorrelationId('corr-1'),
      producer: 'test',
      payload: { name: command.name },
    };
    return {
      success: true,
      value: {
        value: command.name,
        resourceType: 'TestResource',
        resourceId: command.name,
        domainEvents: [event],
      },
    };
  }
}

describe('CommandExecutor', () => {
  const tenantId = asTenantId('tenant-1');
  const ctx: CommandContext = {
    tenantId,
    actor: Actor.system('scheduler', tenantId),
    correlationId: asCorrelationId('corr-1'),
    idempotencyKey: asIdempotencyKey('idem-1'),
  };

  it('publishes events and audits successful commands', async () => {
    const auditLog = new InMemoryAuditLog();
    const publisher = new CollectingEventPublisher();
    const executor = new CommandExecutor({
      telemetry: new NoOpTelemetry(),
      auditLog,
      idempotencyStore: new InMemoryIdempotencyStore(),
      eventPublisher: publisher,
    });

    const result = await executor.execute(ctx, { name: 'foo' }, new TestHandler('foo'), {
      idempotent: true,
      auditAction: 'test.foo',
    });

    expect(result.success).toBe(true);
    expect(publisher.published.length).toBeGreaterThan(0);
    expect(auditLog.records.length).toBe(1);
    expect(auditLog.records[0].entry.action).toBe('test.foo');
    expect(auditLog.records[0].entry.result).toBe('success');
  });

  it('returns cached result for repeated idempotency keys', async () => {
    const handler = new TestHandler('cached');
    const idempotencyStore = new InMemoryIdempotencyStore();
    const executor = new CommandExecutor({
      telemetry: new NoOpTelemetry(),
      auditLog: new InMemoryAuditLog(),
      idempotencyStore,
      eventPublisher: new CollectingEventPublisher(),
    });

    const first = await executor.execute(ctx, { name: 'bar' }, handler, { idempotent: true });
    expect(first.success).toBe(true);

    const second = await executor.execute(ctx, { name: 'bar' }, handler, { idempotent: true });
    expect(second.success).toBe(true);
    expect(second.value).toEqual(first.value);
  });
});
