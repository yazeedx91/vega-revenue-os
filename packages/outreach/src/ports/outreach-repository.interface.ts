import type { TenantContext } from '@projectx/domain';
import type { MessageExecutionStatus, OutreachCampaign, OutreachSequence, OutreachMessageExecution } from '@projectx/domain';
import type { CampaignId, OutreachExecutionId, SequenceId } from '@projectx/shared';

export interface ICampaignRepository {
  save(ctx: TenantContext, campaign: OutreachCampaign): Promise<void>;
  load(ctx: TenantContext, campaignId: CampaignId): Promise<OutreachCampaign | null>;
}

export interface ISequenceRepository {
  save(ctx: TenantContext, sequence: OutreachSequence): Promise<void>;
  load(ctx: TenantContext, sequenceId: SequenceId): Promise<OutreachSequence | null>;
  findByCampaign(ctx: TenantContext, campaignId: CampaignId): Promise<OutreachSequence[]>;
}

export interface IMessageExecutionRepository {
  save(ctx: TenantContext, execution: OutreachMessageExecution): Promise<void>;
  load(ctx: TenantContext, executionId: OutreachExecutionId): Promise<OutreachMessageExecution | null>;
  findBySequence(ctx: TenantContext, sequenceId: SequenceId): Promise<OutreachMessageExecution[]>;
  findByIdempotencyKey(ctx: TenantContext, key: string): Promise<OutreachMessageExecution | null>;
  /**
   * Phase 14 Milestone 6: locates the outbound execution whose
   * `providerMessageId` matches an inbound reply's correlation data
   * (`In-Reply-To`/`References`/provider message id). Used by the Graph
   * inbound reply correlator — never for outbound send logic.
   */
  findByProviderMessageId(ctx: TenantContext, providerMessageId: string): Promise<OutreachMessageExecution | null>;
  /**
   * Phase 14 Milestone 6: fallback correlation path when no
   * message-id-based match exists. Returns every execution sent to the
   * given address so the caller can apply its own disambiguation policy
   * (e.g. most-recent-non-terminal) — this method never guesses on the
   * repository's behalf.
   */
  findByRecipientAddress(ctx: TenantContext, address: string): Promise<OutreachMessageExecution[]>;

  /**
   * P0-3: returns all executions for a tenant whose status is in the given set.
   * Used by the reconciliation query to surface DELIVERY_UNKNOWN and
   * REQUIRES_RECONCILIATION executions for operator review.
   */
  findByStatus(ctx: TenantContext, status: MessageExecutionStatus[]): Promise<OutreachMessageExecution[]>;
}
