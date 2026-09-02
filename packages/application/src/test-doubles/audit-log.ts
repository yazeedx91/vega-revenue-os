import type { CommandContext } from '../commands/command-context';
import type { AuditRecord, IAuditLog } from '../ports/audit-log';

export class InMemoryAuditLog implements IAuditLog {
  readonly records: Array<{ ctx: CommandContext; entry: AuditRecord }> = [];

  async record(ctx: CommandContext, entry: AuditRecord): Promise<void> {
    this.records.push({ ctx, entry });
  }
}
