export interface PromptContext {
  systemPromptVersion: string;
  userMessage: string;
  toolsAvailable: string[];
  memoryContext?: string[];
  knowledgeContext?: string[];
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
