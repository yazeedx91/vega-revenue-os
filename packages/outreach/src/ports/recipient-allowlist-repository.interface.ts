import type { TenantContext } from '@projectx/domain';
import type { OutreachChannel } from '@projectx/domain';

export interface AllowlistEntry {
  readonly address: string;
  readonly channel: OutreachChannel;
  readonly displayName?: string;
  readonly approvedBy: string;
  readonly approvedAt: Date;
  readonly reason?: string;
}

/**
 * Tenant-scoped, deny-by-default recipient allowlist. An address is only
 * eligible to receive outbound sends if an exact-match entry exists for the
 * requesting tenant. There is no wildcard/regex matching — every entry is an
 * explicit, auditable, per-address grant.
 */
export interface IRecipientAllowlistRepository {
  isAllowed(ctx: TenantContext, channel: OutreachChannel, address: string): Promise<boolean>;
  add(
    ctx: TenantContext,
    entry: { channel: OutreachChannel; address: string; displayName?: string; approvedBy: string; reason?: string },
  ): Promise<void>;
  remove(ctx: TenantContext, channel: OutreachChannel, address: string): Promise<void>;
  list(ctx: TenantContext): Promise<AllowlistEntry[]>;
}
