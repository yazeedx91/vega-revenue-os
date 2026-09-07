export interface ContextProvenance {
  /** Stable identifier of the source item (memoryId or chunkId). */
  sourceId: string;
  /** Retrieval channel(s) that surfaced this item, e.g. 'vector', 'fts', 'vector+fts'. */
  channel: string;
  /** Fused relevance score (deterministic RRF). */
  relevance: number;
}

export interface PromptContext {
  systemPromptVersion: string;
  userMessage: string;
  toolsAvailable: string[];
  memoryContext?: string[];
  knowledgeContext?: string[];
  /**
   * Provenance envelopes aligned 1:1 with memoryContext / knowledgeContext.
   * Each entry carries the source identity and fused relevance so downstream
   * consumers can cite where a piece of context came from.
   */
  memoryProvenance?: ContextProvenance[];
  knowledgeProvenance?: ContextProvenance[];
  modelFamily?: string;
  maxTokens?: number;
  timeoutMs?: number;
  tenantId?: string;
  missionId?: string;
  executionId?: string;
  agentId?: string;
  agentVersion?: string;
  capability?: string;
  correlationId?: string;
  idempotencyKey?: string;
}
