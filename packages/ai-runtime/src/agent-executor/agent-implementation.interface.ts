import type { AIExecutionRequest, AIExecutionResult, AgentContract, PromptContext } from '@projectx/shared';
import type { TenantContext } from '@projectx/domain';
import type { IContextAssembler } from '../context-assembler/context-assembler.interface';
import type { IKnowledgeRetriever } from '../knowledge/knowledge-retriever.interface';
import type { IMemoryRetriever } from '../memory/memory-retriever.interface';
import type { IOutputValidator } from '../output-validator/output-validator.interface';
import type { IReasoningEngine, ReasoningOutput } from '../reasoning/reasoning.interface';
import type { IToolClient } from '../tool-client/tool-client.interface';
import type { ITelemetry } from '@projectx/infrastructure';
import type { ICheckpointStore } from '../execution-state/checkpoint-store.interface';
import type { ExecutionState } from '../execution-state/execution-state';

export interface AgentImplementationRuntime {
  tenantContext: TenantContext;
  agent: { contract: AgentContract; implementationKey: string };
  promptContext: PromptContext;
  reasoningEngine: IReasoningEngine;
  reasoningOutput?: ReasoningOutput;
  decisionEngine: import('../decision/decision.interface').IDecisionEngine;
  toolClient: IToolClient;
  outputValidator: IOutputValidator;
  contextAssembler: IContextAssembler;
  memoryRetriever: IMemoryRetriever;
  knowledgeRetriever: IKnowledgeRetriever;
  telemetry: ITelemetry;
  checkpointStore: ICheckpointStore;
  executionState: ExecutionState;
  startedAt: Date;
}

export interface IAgentImplementation {
  readonly implementationKey: string;
  execute(request: AIExecutionRequest, runtime: AgentImplementationRuntime): Promise<AIExecutionResult>;
}
