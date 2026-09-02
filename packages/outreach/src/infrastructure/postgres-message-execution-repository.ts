import type { Pool } from 'pg';
import { OutreachMessageExecution } from '@projectx/domain';
import { ensureSameTenant, type TenantContext } from '@projectx/domain';
import type { MessageDraft, MessageExecutionStatus, OutreachChannel } from '@projectx/domain';
import type { ApprovalId, CampaignId, IdempotencyKey, OutreachExecutionId, OutreachMessageId, SequenceId, TenantId } from '@projectx/shared';
import { PostgresClient, PostgresRepository, toDate } from '@projectx/infrastructure';
import type { IMessageExecutionRepository } from '../ports/outreach-repository.interface';

export interface PostgresMessageExecutionRepositoryConfig {
  pool: Pool;
}

export class PostgresMessageExecutionRepository implements IMessageExecutionRepository {
  private readonly repository: PostgresRepository<OutreachMessageExecution, MessageExecutionSnapshot, OutreachExecutionId>;
  private readonly client: PostgresClient;

  constructor(config: PostgresMessageExecutionRepositoryConfig) {
    this.client = new PostgresClient(config.pool);
    this.repository = new PostgresRepository<OutreachMessageExecution, MessageExecutionSnapshot, OutreachExecutionId>(
      { pool: config.pool, tableName: 'outreach.message_executions' },
      {
        toSnapshot: (entity) => ({
          id: entity.id,
          tenantId: entity.tenantId,
          campaignId: entity.campaignId,
          sequenceId: entity.sequenceId,
          stepNumber: entity.stepNumber,
          leadId: entity.leadId,
          recipientAddress: entity.recipientAddress,
          channel: entity.channel,
          idempotencyKey: entity.idempotencyKey,
          messageId: entity.messageId,
          draft: entity.draft,
          status: entity.status,
          approvalId: entity.approvalId,
          providerId: entity.providerId,
          providerMessageId: entity.providerMessageId,
          attempts: entity.attempts,
          lastError: entity.lastError,
          retryClassification: entity.retryClassification,
          retryAfterMs: entity.retryAfterMs,
          providerErrorCode: entity.providerErrorCode,
          internetMessageId: entity.internetMessageId,
          providerAcceptedAt: entity.providerAcceptedAt,
          deliveredAt: entity.deliveredAt,
          deliveryFailedAt: entity.deliveryFailedAt,
          failedAt: entity.failedAt,
          createdAt: entity.createdAt,
          updatedAt: entity.updatedAt,
        }),
        fromSnapshot: (snapshot, id, tenantId, version) =>
          OutreachMessageExecution.reconstitute(
            {
              ...snapshot,
              id,
              tenantId: tenantId as TenantId,
              channel: snapshot.channel as OutreachChannel,
              idempotencyKey: snapshot.idempotencyKey as IdempotencyKey,
              messageId: snapshot.messageId as OutreachMessageId | undefined,
              draft: snapshot.draft as MessageDraft | undefined,
              status: snapshot.status as MessageExecutionStatus,
              approvalId: snapshot.approvalId as ApprovalId | undefined,
              providerErrorCode: snapshot.providerErrorCode,
              internetMessageId: snapshot.internetMessageId,
              providerAcceptedAt: snapshot.providerAcceptedAt ? toDate(snapshot.providerAcceptedAt) : undefined,
              deliveredAt: snapshot.deliveredAt ? toDate(snapshot.deliveredAt) : undefined,
              deliveryFailedAt: snapshot.deliveryFailedAt ? toDate(snapshot.deliveryFailedAt) : undefined,
              failedAt: snapshot.failedAt ? toDate(snapshot.failedAt) : undefined,
              createdAt: toDate(snapshot.createdAt),
              updatedAt: toDate(snapshot.updatedAt),
            },
            version,
          ),
      },
    );
  }

  async save(ctx: TenantContext, execution: OutreachMessageExecution): Promise<void> {
    ensureSameTenant(ctx, execution.tenantId);
    await this.repository.save(ctx, execution);
  }

  async load(ctx: TenantContext, executionId: OutreachExecutionId): Promise<OutreachMessageExecution | null> {
    return this.repository.findById(ctx, executionId);
  }

  async findBySequence(ctx: TenantContext, sequenceId: SequenceId): Promise<OutreachMessageExecution[]> {
    const result = await this.client.withTenant(ctx, async (client) => {
      return client.query(
        `SELECT payload, version FROM outreach.message_executions WHERE tenant_id = $1 AND payload->>'sequenceId' = $2`,
        [ctx.tenantId as string, sequenceId],
      );
    });

    return result.rows.map((row) => {
      const snapshot = row.payload as MessageExecutionSnapshot;
      return OutreachMessageExecution.reconstitute(
        {
          ...snapshot,
          tenantId: ctx.tenantId as TenantId,
          channel: snapshot.channel as OutreachChannel,
          idempotencyKey: snapshot.idempotencyKey as IdempotencyKey,
          messageId: snapshot.messageId as OutreachMessageId | undefined,
          draft: snapshot.draft as MessageDraft | undefined,
          status: snapshot.status as MessageExecutionStatus,
          approvalId: snapshot.approvalId as ApprovalId | undefined,
          providerAcceptedAt: snapshot.providerAcceptedAt ? new Date(snapshot.providerAcceptedAt) : undefined,
          deliveredAt: snapshot.deliveredAt ? new Date(snapshot.deliveredAt) : undefined,
          deliveryFailedAt: snapshot.deliveryFailedAt ? new Date(snapshot.deliveryFailedAt) : undefined,
          failedAt: snapshot.failedAt ? new Date(snapshot.failedAt) : undefined,
          createdAt: new Date(snapshot.createdAt),
          updatedAt: new Date(snapshot.updatedAt),
        },
        row.version as number,
      );
    });
  }

  async findByIdempotencyKey(ctx: TenantContext, key: string): Promise<OutreachMessageExecution | null> {
    const result = await this.client.withTenant(ctx, async (client) => {
      return client.query(
        `SELECT payload, version FROM outreach.message_executions WHERE tenant_id = $1 AND payload->>'idempotencyKey' = $2 LIMIT 1`,
        [ctx.tenantId as string, key],
      );
    });

    if (result.rows.length === 0) {
      return null;
    }

    const snapshot = result.rows[0].payload as MessageExecutionSnapshot;
    return OutreachMessageExecution.reconstitute(
      {
        ...snapshot,
        tenantId: ctx.tenantId as TenantId,
        channel: snapshot.channel as OutreachChannel,
        idempotencyKey: snapshot.idempotencyKey as IdempotencyKey,
        messageId: snapshot.messageId as OutreachMessageId | undefined,
        draft: snapshot.draft as MessageDraft | undefined,
        status: snapshot.status as MessageExecutionStatus,
        approvalId: snapshot.approvalId as ApprovalId | undefined,
        providerErrorCode: snapshot.providerErrorCode,
        internetMessageId: snapshot.internetMessageId,
        providerAcceptedAt: snapshot.providerAcceptedAt ? toDate(snapshot.providerAcceptedAt) : undefined,
        deliveredAt: snapshot.deliveredAt ? toDate(snapshot.deliveredAt) : undefined,
        deliveryFailedAt: snapshot.deliveryFailedAt ? toDate(snapshot.deliveryFailedAt) : undefined,
        failedAt: snapshot.failedAt ? toDate(snapshot.failedAt) : undefined,
        createdAt: toDate(snapshot.createdAt),
        updatedAt: toDate(snapshot.updatedAt),
      },
      result.rows[0].version as number,
    );
  }

  async findByProviderMessageId(ctx: TenantContext, providerMessageId: string): Promise<OutreachMessageExecution | null> {
    const result = await this.client.withTenant(ctx, async (client) => {
      return client.query(
        `SELECT payload, version FROM outreach.message_executions WHERE tenant_id = $1 AND payload->>'providerMessageId' = $2 LIMIT 1`,
        [ctx.tenantId as string, providerMessageId],
      );
    });

    if (result.rows.length === 0) {
      return null;
    }

    return this.reconstituteRow(ctx, result.rows[0]);
  }

  async findByRecipientAddress(ctx: TenantContext, address: string): Promise<OutreachMessageExecution[]> {
    const result = await this.client.withTenant(ctx, async (client) => {
      return client.query(
        `SELECT payload, version FROM outreach.message_executions WHERE tenant_id = $1 AND payload->>'recipientAddress' = $2`,
        [ctx.tenantId as string, address],
      );
    });

    return result.rows.map((row) => this.reconstituteRow(ctx, row));
  }

  async findByStatus(ctx: TenantContext, status: MessageExecutionStatus[]): Promise<OutreachMessageExecution[]> {
    const result = await this.client.withTenant(ctx, async (client) => {
      return client.query(
        `SELECT payload, version FROM outreach.message_executions WHERE tenant_id = $1 AND payload->>'status' = ANY($2)`,
        [ctx.tenantId as string, status],
      );
    });

    return result.rows.map((row) => this.reconstituteRow(ctx, row));
  }

  private reconstituteRow(ctx: TenantContext, row: { payload: unknown; version: number }): OutreachMessageExecution {
    const snapshot = row.payload as MessageExecutionSnapshot;
    return OutreachMessageExecution.reconstitute(
      {
        ...snapshot,
        tenantId: ctx.tenantId as TenantId,
        channel: snapshot.channel as OutreachChannel,
        idempotencyKey: snapshot.idempotencyKey as IdempotencyKey,
        messageId: snapshot.messageId as OutreachMessageId | undefined,
        draft: snapshot.draft as MessageDraft | undefined,
        status: snapshot.status as MessageExecutionStatus,
        approvalId: snapshot.approvalId as ApprovalId | undefined,
        providerErrorCode: snapshot.providerErrorCode,
        internetMessageId: snapshot.internetMessageId,
        providerAcceptedAt: snapshot.providerAcceptedAt ? toDate(snapshot.providerAcceptedAt) : undefined,
        deliveredAt: snapshot.deliveredAt ? toDate(snapshot.deliveredAt) : undefined,
        deliveryFailedAt: snapshot.deliveryFailedAt ? toDate(snapshot.deliveryFailedAt) : undefined,
        failedAt: snapshot.failedAt ? toDate(snapshot.failedAt) : undefined,
        createdAt: toDate(snapshot.createdAt),
        updatedAt: toDate(snapshot.updatedAt),
      },
      row.version,
    );
  }
}

type MessageExecutionSnapshot = {
  id?: OutreachExecutionId;
  tenantId?: string & { readonly __brand: 'TenantId' };
  campaignId: CampaignId;
  sequenceId: SequenceId;
  stepNumber: number;
  leadId: string;
  recipientAddress: string;
  channel: string;
  idempotencyKey: string;
  messageId?: string;
  draft?: unknown;
  status: string;
  approvalId?: string;
  providerId?: string;
  providerMessageId?: string;
  internetMessageId?: string;
  attempts: number;
  lastError?: string;
  retryClassification?: 'RETRYABLE' | 'NON_RETRYABLE' | 'RATE_LIMITED';
  retryAfterMs?: number;
  providerErrorCode?: string;
  providerAcceptedAt?: Date;
  deliveredAt?: Date;
  deliveryFailedAt?: Date;
  failedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};
