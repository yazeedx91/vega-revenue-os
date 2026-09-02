import type { TenantContext } from '@projectx/domain';
import type { OutreachChannel } from '@projectx/domain';
import type { IOutreachProvider } from './outreach-provider.interface';

export interface IOutreachProviderRegistry {
  register(provider: IOutreachProvider): void;
  select(ctx: TenantContext, channel: OutreachChannel): Promise<IOutreachProvider | null>;
}
