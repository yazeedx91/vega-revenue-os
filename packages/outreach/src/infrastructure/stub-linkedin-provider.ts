import type { TenantContext } from '@projectx/domain';
import type { ProviderSendRequest, ProviderSendResult } from '@projectx/domain';
import type { ILinkedInProvider } from '../ports/linkedin-provider.interface';

export type StubLinkedInBehavior =
  | { type: 'success'; costUsd?: number }
  | { type: 'failure'; classification: 'RETRYABLE' | 'NON_RETRYABLE' | 'RATE_LIMITED'; errorMessage: string; errorCode?: string; retryAfterMs?: number };

export class StubLinkedInProvider implements ILinkedInProvider {
  readonly providerId = 'stub-linkedin';
  readonly channel = 'linkedin' as const;
  private readonly accepted = new Map<string, string>();

  constructor(private readonly behavior: StubLinkedInBehavior = { type: 'success', costUsd: 0.15 }) {}

  async send(_ctx: TenantContext, request: ProviderSendRequest): Promise<ProviderSendResult> {
    const key = request.idempotencyKey as string;
    const existing = this.accepted.get(key);
    if (existing) {
      return { providerMessageId: existing, status: 'ACCEPTED', costUsd: this.behavior.type === 'success' ? (this.behavior.costUsd ?? 0.15) : 0 };
    }

    if (this.behavior.type === 'failure') {
      return {
        status: 'FAILED',
        retryClassification: this.behavior.classification,
        retryAfterMs: this.behavior.retryAfterMs,
        providerErrorCode: this.behavior.errorCode,
        providerErrorMessage: this.behavior.errorMessage,
        costUsd: 0,
      };
    }

    const providerMessageId = `linkedin-msg-${key}`;
    this.accepted.set(key, providerMessageId);
    return { providerMessageId, status: 'ACCEPTED', costUsd: this.behavior.costUsd ?? 0.15 };
  }

  async checkHealth(_ctx: TenantContext): Promise<{ healthy: boolean; reason?: string }> {
    return { healthy: true };
  }
}
