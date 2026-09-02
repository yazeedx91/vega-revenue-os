import type { CampaignId, CorrelationId, IdempotencyKey, OutreachExecutionId, OutreachMessageId, SequenceId, TenantId } from '@projectx/shared';

export type OutreachChannel = 'email' | 'linkedin' | 'calendar';

export type RetryClassification = 'RETRYABLE' | 'NON_RETRYABLE' | 'RATE_LIMITED';

export interface ProviderSendRequest {
  readonly idempotencyKey: IdempotencyKey;
  readonly correlationId: CorrelationId;
  readonly executionId: OutreachExecutionId;
  readonly tenantId: TenantId;
  readonly campaignId: CampaignId;
  readonly sequenceId: SequenceId;
  readonly messageId: OutreachMessageId;
  readonly recipientAddress: string;
  readonly subject?: string;
  readonly body: string;
  readonly cta?: string;
  readonly channel: OutreachChannel;
  readonly metadata?: Record<string, unknown>;
}

export interface ProviderSendResult {
  readonly providerMessageId?: string;
  readonly internetMessageId?: string;
  readonly status: 'PROVIDER_ACCEPTED' | 'ACCEPTED' | 'DELIVERED' | 'FAILED' | 'RATE_LIMITED' | 'AMBIGUOUS';
  readonly retryClassification?: RetryClassification;
  readonly retryAfterMs?: number;
  readonly providerErrorCode?: string;
  readonly providerErrorMessage?: string;
  readonly costUsd: number;
}

export interface ProviderHealth {
  readonly healthy: boolean;
  readonly reason?: string;
}
