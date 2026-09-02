export interface LLMCompletion {
  content?: string;
  toolCalls?: LLMToolCall[];
  model: string;
  provider: string;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
}

export interface LLMToolCall {
  toolId: string;
  toolVersion: string;
  input: unknown;
}
