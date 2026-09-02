import type { TenantContext } from '@projectx/domain';
import type { ProviderHealth, ProviderSendRequest, ProviderSendResult } from '@projectx/domain';

export interface IOutreachProvider {
  readonly providerId: string;
  readonly channel: 'email' | 'linkedin' | 'calendar';
  send(ctx: TenantContext, request: ProviderSendRequest): Promise<ProviderSendResult>;
  checkHealth(ctx: TenantContext): Promise<ProviderHealth>;
}
