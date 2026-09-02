import type { TenantContext } from '@projectx/domain';
import type { CorrelationId, IdempotencyKey } from '@projectx/shared';

/**
 * Retrieves knowledge relevant to a tenant task.
 */
export interface IKnowledgeRetriever {
  retrieve(ctx: TenantContext, query: KnowledgeQuery): Promise<KnowledgeEntry[]>;
}

export interface KnowledgeQuery {
  domain: string;
  query: string;
  correlationId: CorrelationId;
  idempotencyKey?: IdempotencyKey;
  deadline?: Date;
  abortSignal?: AbortSignal;
}

export interface KnowledgeEntry {
  knowledgeId: string;
  domain: string;
  content: string;
  relevance: number;
}
