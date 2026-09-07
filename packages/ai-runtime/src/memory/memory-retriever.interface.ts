import type { TenantContext } from '@projectx/domain';
import type { CorrelationId, IdempotencyKey } from '@projectx/shared';

/**
 * Retrieves agent memory scoped to a tenant.
 */
export interface IMemoryRetriever {
  retrieve(ctx: TenantContext, query: MemoryQuery): Promise<MemoryEntry[]>;
}

export interface MemoryQuery {
  agentId: string;
  types: string[];
  query: string;
  correlationId: CorrelationId;
  idempotencyKey?: IdempotencyKey;
  deadline?: Date;
  abortSignal?: AbortSignal;
}

export interface MemoryEntry {
  memoryId: string;
  type: string;
  content: string;
  relevance: number;
  /** Retrieval channel(s) that surfaced this entry, e.g. 'vector+fts'. */
  channel?: string;
}
