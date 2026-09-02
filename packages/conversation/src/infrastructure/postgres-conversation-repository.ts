import type { Pool } from 'pg';
import { Conversation, ReplyMessage } from '@projectx/domain';
import { ensureSameTenant, type TenantContext } from '@projectx/domain';
import type { ConversationStatus, NextActionType, ReplyIntent } from '@projectx/domain';
import type { ConversationId, LeadId, TenantId } from '@projectx/shared';
import { asReplyMessageId } from '@projectx/shared';
import { PostgresClient, PostgresRepository, toDate } from '@projectx/infrastructure';
import type { IConversationRepository } from '../ports/conversation-repository.interface';

type ReplyMessageSnapshot = {
  id: string;
  providerMessageId: string;
  channel: string;
  content: string;
  receivedAt: string | Date;
  messageIdHeader?: string;
  sender?: string;
  recipientAddress?: string;
  subject?: string;
  htmlBody?: string;
  inReplyTo?: string;
  references?: string[];
};

function toReplyMessageSnapshot(message: ReplyMessage): ReplyMessageSnapshot {
  return {
    id: message.id as string,
    providerMessageId: message.providerMessageId,
    channel: message.channel,
    content: message.content,
    receivedAt: message.receivedAt,
    messageIdHeader: message.messageIdHeader,
    sender: message.sender,
    recipientAddress: message.recipientAddress,
    subject: message.subject,
    htmlBody: message.htmlBody,
    inReplyTo: message.inReplyTo,
    references: message.references,
  };
}

function fromReplyMessageSnapshot(raw: ReplyMessageSnapshot): ReplyMessage {
  return new ReplyMessage({
    id: asReplyMessageId(raw.id),
    providerMessageId: raw.providerMessageId,
    channel: raw.channel,
    content: raw.content,
    receivedAt: toDate(raw.receivedAt)!,
    messageIdHeader: raw.messageIdHeader,
    sender: raw.sender,
    recipientAddress: raw.recipientAddress,
    subject: raw.subject,
    htmlBody: raw.htmlBody,
    inReplyTo: raw.inReplyTo,
    references: raw.references,
  });
}

export interface PostgresConversationRepositoryConfig {
  pool: Pool;
}

export class PostgresConversationRepository implements IConversationRepository {
  private readonly repository: PostgresRepository<Conversation, ConversationSnapshot, ConversationId>;
  private readonly client: PostgresClient;

  constructor(config: PostgresConversationRepositoryConfig) {
    this.client = new PostgresClient(config.pool);
    this.repository = new PostgresRepository<Conversation, ConversationSnapshot, ConversationId>(
      { pool: config.pool, tableName: 'conversation.conversations' },
      {
        toSnapshot: (entity) => ({
          id: entity.id,
          tenantId: entity.tenantId,
          leadId: entity.leadId,
          channel: entity.channel,
          recipientAddress: entity.recipientAddress,
          campaignId: entity.campaignId,
          sequenceId: entity.sequenceId,
          executionId: entity.executionId,
          status: entity.status,
          messages: entity.messages.map(toReplyMessageSnapshot),
          latestIntent: entity.latestIntent,
          latestConfidence: entity.latestConfidence,
          nextAction: entity.nextAction,
          escalatedReason: entity.escalatedReason,
          optedOut: entity.optedOut,
          createdAt: entity.createdAt,
          updatedAt: entity.updatedAt,
        }),
        fromSnapshot: (snapshot, id, tenantId, version) =>
          Conversation.reconstitute(
            {
              ...snapshot,
              id,
              tenantId: tenantId as TenantId,
              leadId: snapshot.leadId as LeadId,
              status: snapshot.status as ConversationStatus,
              latestIntent: snapshot.latestIntent as ReplyIntent | undefined,
              nextAction: snapshot.nextAction as NextActionType | undefined,
              messages: (snapshot.messages ?? []).map(fromReplyMessageSnapshot),
              createdAt: toDate(snapshot.createdAt),
              updatedAt: toDate(snapshot.updatedAt),
            },
            version,
          ),
      },
    );
  }

  async load(ctx: TenantContext, id: ConversationId): Promise<Conversation | null> {
    return this.repository.findById(ctx, id);
  }

  async save(ctx: TenantContext, conversation: Conversation): Promise<void> {
    ensureSameTenant(ctx, conversation.tenantId);
    await this.repository.save(ctx, conversation);
  }

  async findByLeadAndChannel(
    ctx: TenantContext,
    leadId: string,
    channel: string,
  ): Promise<Conversation | null> {
    const result = await this.client.withTenant(ctx, async (client) => {
      return client.query(
        `SELECT payload, version FROM conversation.conversations
         WHERE tenant_id = $1 AND payload->>'leadId' = $2 AND payload->>'channel' = $3
         LIMIT 1`,
        [ctx.tenantId as string, leadId, channel],
      );
    });

    if (result.rows.length === 0) {
      return null;
    }

    const snapshot = result.rows[0].payload as ConversationSnapshot;
    return Conversation.reconstitute(
      {
        ...snapshot,
        id: snapshot.id as ConversationId,
        tenantId: ctx.tenantId as TenantId,
        leadId: snapshot.leadId as LeadId,
        status: snapshot.status as ConversationStatus,
        latestIntent: snapshot.latestIntent as ReplyIntent | undefined,
        nextAction: snapshot.nextAction as NextActionType | undefined,
        messages: (snapshot.messages ?? []).map(fromReplyMessageSnapshot),
        createdAt: toDate(snapshot.createdAt),
        updatedAt: toDate(snapshot.updatedAt),
      },
      result.rows[0].version as number,
    );
  }
}

type ConversationSnapshot = {
  id?: ConversationId;
  tenantId?: string & { readonly __brand: 'TenantId' };
  leadId: string;
  channel: string;
  recipientAddress?: string;
  campaignId?: string;
  sequenceId?: string;
  executionId?: string;
  status: string;
  messages: ReplyMessageSnapshot[];
  latestIntent?: string;
  latestConfidence?: number;
  nextAction?: string;
  escalatedReason?: string;
  optedOut: boolean;
  createdAt: Date;
  updatedAt: Date;
};
