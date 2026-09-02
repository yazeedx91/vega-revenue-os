export interface PromptContext {
  systemPromptVersion: string;
  userMessage: string;
  toolsAvailable: string[];
  memoryContext?: string[];
  knowledgeContext?: string[];
  modelFamily?: string;
  maxTokens?: number;
  timeoutMs?: number;
}
