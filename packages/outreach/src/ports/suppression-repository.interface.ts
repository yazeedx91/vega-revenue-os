import type { TenantContext } from '@projectx/domain';

export type SuppressionType = 'MANUAL' | 'OPT_OUT' | 'UNSUBSCRIBE' | 'BOUNCE' | 'ADMINISTRATIVE';

export interface SuppressionRecord {
  readonly address: string;
  readonly suppressionType: SuppressionType;
  readonly source: string;
  readonly reason?: string;
  readonly createdAt: Date;
}

/**
 * Tenant-scoped, durable suppression / opt-out store. A suppressed address
 * MUST block every outbound send path for that tenant, regardless of which
 * subsystem originally recorded the suppression (manual entry, reply-based
 * opt-out, unsubscribe link, provider bounce webhook, or administrative
 * action).
 */
export interface ISuppressionRepository {
  isSuppressed(ctx: TenantContext, address: string): Promise<SuppressionRecord | null>;
  suppress(
    ctx: TenantContext,
    address: string,
    suppressionType: SuppressionType,
    source: string,
    reason?: string,
  ): Promise<void>;
  list(ctx: TenantContext): Promise<SuppressionRecord[]>;
}
