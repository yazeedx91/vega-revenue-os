import { Entity } from '../entity/entity';
import type { Capability } from './capability';

export interface AgentConfigurationSnapshot {
  readonly capabilities: Capability[];
  readonly tools: string[];
  readonly policies: { policyId: string; version: string }[];
  readonly modelPolicy: {
    readonly preferredModelFamily: string;
    readonly maxCostPerTaskUsd: number;
    readonly maxTokensPerTask: number;
  };
  readonly memoryPolicy: {
    readonly read: string[];
    readonly write: string[];
    readonly validationRequired: boolean;
  };
  readonly knowledgePolicy: {
    readonly read: string[];
    readonly write: string[];
  };
  readonly autonomyLevelDefault: number;
  readonly evaluationPolicy: {
    readonly criteria: string[];
    readonly minScore: number;
  };
}

export class AgentVersion extends Entity<string> {
  constructor(
    version: string,
    public readonly configuration: AgentConfigurationSnapshot,
    public readonly publishedAt: Date = new Date(),
  ) {
    super(version);
  }
}
