import type { TenantContext } from '@projectx/domain';
import type { OutreachChannel } from '@projectx/domain';
import type { AllowlistEntry, IRecipientAllowlistRepository } from '../ports/recipient-allowlist-repository.interface';

export class InMemoryRecipientAllowlistRepository implements IRecipientAllowlistRepository {
  private readonly store = new Map<string, AllowlistEntry>();

  private key(tenantId: string, channel: string, address: string): string {
    return `${tenantId}:${channel}:${address}`;
  }

  async isAllowed(ctx: TenantContext, channel: OutreachChannel, address: string): Promise<boolean> {
    return this.store.has(this.key(ctx.tenantId as string, channel, address));
  }

  async add(
    ctx: TenantContext,
    entry: { channel: OutreachChannel; address: string; displayName?: string; approvedBy: string; reason?: string },
  ): Promise<void> {
    this.store.set(this.key(ctx.tenantId as string, entry.channel, entry.address), {
      address: entry.address,
      channel: entry.channel,
      displayName: entry.displayName,
      approvedBy: entry.approvedBy,
      approvedAt: new Date(),
      reason: entry.reason,
    });
  }

  async remove(ctx: TenantContext, channel: OutreachChannel, address: string): Promise<void> {
    this.store.delete(this.key(ctx.tenantId as string, channel, address));
  }

  async list(ctx: TenantContext): Promise<AllowlistEntry[]> {
    return [...this.store.entries()].filter(([key]) => key.startsWith(`${ctx.tenantId as string}:`)).map(([, entry]) => entry);
  }
}
