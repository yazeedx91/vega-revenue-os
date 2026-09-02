import { ensureSameTenant, type TenantContext } from '@projectx/domain';
import type { OutreachChannel } from '@projectx/domain';
import type { IOutreachProvider } from '../ports/outreach-provider.interface';
import type { IOutreachProviderRegistry } from '../ports/outreach-provider-registry.interface';

export class InMemoryOutreachProviderRegistry implements IOutreachProviderRegistry {
  private readonly providers = new Map<string, IOutreachProvider>();
  private readonly tenantChannels = new Map<string, Map<string, string>>();

  register(provider: IOutreachProvider): void {
    this.providers.set(provider.providerId, provider);
  }

  setTenantProvider(tenantId: string, channel: OutreachChannel, providerId: string): void {
    if (!this.providers.has(providerId)) {
      throw new Error(`Provider ${providerId} not registered`);
    }
    let map = this.tenantChannels.get(tenantId);
    if (!map) {
      map = new Map();
      this.tenantChannels.set(tenantId, map);
    }
    map.set(channel, providerId);
  }

  async select(ctx: TenantContext, channel: OutreachChannel): Promise<IOutreachProvider | null> {
    const map = this.tenantChannels.get(ctx.tenantId as string);
    const providerId = map?.get(channel);
    if (!providerId) return null;
    const provider = this.providers.get(providerId);
    if (provider && provider.channel !== channel) {
      return null;
    }
    return provider ?? null;
  }

  async providersFor(ctx: TenantContext): Promise<IOutreachProvider[]> {
    const map = this.tenantChannels.get(ctx.tenantId as string);
    if (!map) return [];
    const result: IOutreachProvider[] = [];
    for (const providerId of map.values()) {
      const provider = this.providers.get(providerId);
      if (provider) result.push(provider);
    }
    return result;
  }

  getProviderCount(): number {
    return this.providers.size;
  }

  getTenantMappingCount(): number {
    let count = 0;
    for (const map of this.tenantChannels.values()) {
      count += map.size;
    }
    return count;
  }
}
