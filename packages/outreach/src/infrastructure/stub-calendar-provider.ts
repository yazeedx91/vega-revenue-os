import type { TenantContext } from '@projectx/domain';
import type { ProviderSendRequest, ProviderSendResult } from '@projectx/domain';
import type { ICalendarProvider } from '../ports/calendar-provider.interface';

export class StubCalendarProvider implements ICalendarProvider {
  readonly providerId = 'stub-calendar';
  readonly channel = 'calendar' as const;

  async send(_ctx: TenantContext, _request: ProviderSendRequest): Promise<ProviderSendResult> {
    return {
      status: 'FAILED',
      retryClassification: 'NON_RETRYABLE',
      providerErrorCode: 'NOT_SUPPORTED',
      providerErrorMessage: 'Calendar invitations are not supported in Phase 12',
      costUsd: 0,
    };
  }

  async checkHealth(_ctx: TenantContext): Promise<{ healthy: boolean; reason?: string }> {
    return { healthy: false, reason: 'Calendar channel is stubbed out in Phase 12' };
  }
}
