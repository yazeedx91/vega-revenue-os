import type { ProviderSendRequest, ProviderSendResult, TenantContext } from '@projectx/domain';
import type { IEmailProvider } from '../ports/email-provider.interface';

export type StubEmailBehavior =
  | { type: 'success'; costUsd?: number }
  | {
      type: 'failure';
      classification: 'RETRYABLE' | 'NON_RETRYABLE' | 'RATE_LIMITED';
      errorMessage: string;
      errorCode?: string;
      retryAfterMs?: number;
    }
  | { type: 'timeout-after-accept'; costUsd?: number };

export interface StubSentMessage {
  readonly providerMessageId?: string;
  readonly tenantId: string;
  readonly campaignId: string;
  readonly sequenceId: string;
  readonly executionId: string;
  readonly messageId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly recipientAddress: string;
  readonly subject?: string;
  readonly body: string;
  readonly timestamp: Date;
  readonly simulatedStatus: 'PROVIDER_ACCEPTED' | 'FAILED' | 'RATE_LIMITED' | 'TIMEOUT_AFTER_ACCEPT' | 'AMBIGUOUS';
  readonly providerErrorCode?: string;
  readonly providerErrorMessage?: string;
}

export class StubEmailProvider implements IEmailProvider {
  readonly providerId = 'stub-email';
  readonly channel = 'email' as const;

  private readonly accepted = new Map<string, { providerMessageId: string; costUsd: number }>();
  private sentMessages: StubSentMessage[] = [];
  private lastResult?: ProviderSendResult;
  private defaultBehavior: StubEmailBehavior;

  constructor(behavior: StubEmailBehavior = { type: 'success', costUsd: 0.1 }) {
    this.defaultBehavior = behavior;
  }

  private get behavior(): StubEmailBehavior {
    return this.defaultBehavior;
  }

  /** Test-only control surface. */
  configureFailure(behavior: StubEmailBehavior): void {
    this.defaultBehavior = behavior;
  }

  /** Test-only control surface. */
  simulateAcceptedThenTimeout(costUsd?: number): void {
    this.defaultBehavior = { type: 'timeout-after-accept', costUsd };
  }

  /** Test-only control surface. */
  reset(): void {
    this.accepted.clear();
    this.sentMessages = [];
    this.lastResult = undefined;
    this.defaultBehavior = { type: 'success', costUsd: 0.1 };
  }

  /** Test-only inspection surface. */
  getSentMessages(): readonly StubSentMessage[] {
    return this.sentMessages;
  }

  /** Test-only inspection surface. */
  getLastResult(): ProviderSendResult | undefined {
    return this.lastResult;
  }

  async send(_ctx: TenantContext, request: ProviderSendRequest): Promise<ProviderSendResult> {
    const key = request.idempotencyKey as string;
    const providerMessageId = this.makeProviderMessageId(request);
    const costUsd = this.behavior.type === 'success' ? (this.behavior.costUsd ?? 0.1) : 0;

    const accepted = this.accepted.get(key);
    if (accepted) {
      const result: ProviderSendResult = {
        providerMessageId: accepted.providerMessageId,
        status: 'PROVIDER_ACCEPTED',
        costUsd: accepted.costUsd,
      };
      const index = this.sentMessages.findIndex((m) => m.idempotencyKey === key);
      if (index !== -1) {
        this.sentMessages[index] = {
          ...this.sentMessages[index],
          simulatedStatus: 'PROVIDER_ACCEPTED',
          providerMessageId: accepted.providerMessageId,
        };
      }
      this.lastResult = result;
      return result;
    }

    if (this.behavior.type === 'timeout-after-accept') {
      const finalCost = this.behavior.costUsd ?? 0.1;
      this.accepted.set(key, { providerMessageId, costUsd: finalCost });
      this.record(request, providerMessageId, 'AMBIGUOUS');
      const result: ProviderSendResult = { providerMessageId, status: 'AMBIGUOUS', costUsd: finalCost };
      this.lastResult = result;
      return result;
    }

    if (this.behavior.type === 'failure') {
      const status = this.behavior.classification === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'FAILED';
      const result: ProviderSendResult = {
        status,
        retryClassification: this.behavior.classification,
        retryAfterMs: this.behavior.retryAfterMs,
        providerErrorCode: this.behavior.errorCode,
        providerErrorMessage: this.behavior.errorMessage,
        costUsd: 0,
      };
      this.record(request, undefined, status as 'FAILED' | 'RATE_LIMITED', result);
      this.lastResult = result;
      return result;
    }

    this.accepted.set(key, { providerMessageId, costUsd });
    const result: ProviderSendResult = { providerMessageId, status: 'PROVIDER_ACCEPTED', costUsd };
    this.record(request, providerMessageId, 'PROVIDER_ACCEPTED', result);
    this.lastResult = result;
    return result;
  }

  async checkHealth(_ctx: TenantContext): Promise<{ healthy: boolean; reason?: string }> {
    return { healthy: true };
  }

  private makeProviderMessageId(request: ProviderSendRequest): string {
    // Deterministic for the same logical send; stable across retries.
    return `stub-email-${request.tenantId as string}-${request.sequenceId as string}-${request.executionId as string}-${request.idempotencyKey as string}`;
  }

  private record(
    request: ProviderSendRequest,
    providerMessageId: string | undefined,
    simulatedStatus: StubSentMessage['simulatedStatus'],
    result?: ProviderSendResult,
  ): void {
    this.sentMessages.push({
      providerMessageId,
      tenantId: request.tenantId as string,
      campaignId: request.campaignId as string,
      sequenceId: request.sequenceId as string,
      executionId: request.executionId as string,
      messageId: request.messageId as string,
      idempotencyKey: request.idempotencyKey as string,
      correlationId: request.correlationId as string,
      recipientAddress: request.recipientAddress,
      subject: request.subject,
      body: request.body,
      timestamp: new Date(),
      simulatedStatus,
      providerErrorCode: result?.providerErrorCode,
      providerErrorMessage: result?.providerErrorMessage,
    });
  }
}

export class ProviderTimeoutError extends Error {
  constructor(message = 'Provider call timed out') {
    super(message);
    this.name = 'ProviderTimeoutError';
  }
}
