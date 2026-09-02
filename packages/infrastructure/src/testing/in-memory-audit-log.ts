import type { TenantContext } from '@projectx/domain';
import type { AuditRecord, IAuditLog } from '../audit/audit-log.interface';

export interface RecordedAuditEntry extends AuditRecord {
  readonly tenantId: string;
  readonly correlationId: string;
  readonly occurredAt: Date;
}

/** Deterministic in-memory IAuditLog test double — every decision is retained for assertions. */
export class InMemoryAuditLog implements IAuditLog {
  readonly entries: RecordedAuditEntry[] = [];

  async record(ctx: TenantContext, entry: AuditRecord): Promise<void> {
    this.entries.push({
      ...entry,
      tenantId: ctx.tenantId as string,
      correlationId: ctx.correlationId as string,
      occurredAt: new Date(),
    });
  }

  clear(): void {
    this.entries.length = 0;
  }
}
