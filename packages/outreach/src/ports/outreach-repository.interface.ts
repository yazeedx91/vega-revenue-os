import type { TenantContext } from '@projectx/domain';
import type { MessageExecutionStatus, OutreachCampaign, OutreachSequence, OutreachMessageExecution } from '@projectx/domain';
import type { CampaignId, OutreachExecutionId, SequenceId } from '@projectx/shared';

export interface OutreachRepositoryContext extends TenantContext {
  readonly workspaceId: string;
}

export interface ICampaignRepository {
  save(ctx: OutreachRepositoryContext, campaign: OutreachCampaign): Promise<void>;
  load(ctx: OutreachRepositoryContext, campaignId: CampaignId): Promise<OutreachCampaign | null>;
}

export interface ISequenceRepository {
  save(ctx: OutreachRepositoryContext, sequence: OutreachSequence): Promise<void>;
  load(ctx: OutreachRepositoryContext, sequenceId: SequenceId): Promise<OutreachSequence | null>;
  findByCampaign(ctx: OutreachRepositoryContext, campaignId: CampaignId): Promise<OutreachSequence[]>;
}

export interface IMessageExecutionRepository {
  save(ctx: OutreachRepositoryContext, execution: OutreachMessageExecution): Promise<void>;
  load(ctx: OutreachRepositoryContext, executionId: OutreachExecutionId): Promise<OutreachMessageExecution | null>;
  findBySequence(ctx: OutreachRepositoryContext, sequenceId: SequenceId): Promise<OutreachMessageExecution[]>;
  findByIdempotencyKey(ctx: OutreachRepositoryContext, key: string): Promise<OutreachMessageExecution | null>;
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
  findByRecipientFingerprint(ctx: OutreachRepositoryContext, fingerprint: string): Promise<OutreachMessageExecution[]>;

  /**
   * P0-3: returns all executions for a tenant whose status is in the given set.
   * Used by the reconciliation query to surface DELIVERY_UNKNOWN and
   * REQUIRES_RECONCILIATION executions for operator review.
   */
  findByStatus(ctx: OutreachRepositoryContext, status: MessageExecutionStatus[]): Promise<OutreachMessageExecution[]>;
}
