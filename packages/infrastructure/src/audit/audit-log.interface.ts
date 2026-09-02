import type { TenantContext } from '@projectx/domain';

export interface AuditRecord {
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly result: 'success' | 'denied' | 'failure';
  readonly reason?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface IAuditLog {
  record(ctx: TenantContext, entry: AuditRecord): Promise<void>;
}
