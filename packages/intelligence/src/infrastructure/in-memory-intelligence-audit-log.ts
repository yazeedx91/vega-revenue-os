import type { TenantContext } from '@projectx/domain';
import type { IIntelligenceAuditLog, IntelligenceAuditEntry } from '../ports/intelligence-audit-log.interface';

export class InMemoryIntelligenceAuditLog implements IIntelligenceAuditLog {
  readonly records: Array<{ ctx: TenantContext; entry: IntelligenceAuditEntry }> = [];

  async record(ctx: TenantContext, entry: IntelligenceAuditEntry): Promise<void> {
    this.records.push({ ctx, entry });
  }
}
