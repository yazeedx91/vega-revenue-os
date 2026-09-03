import type { TenantContext } from '@projectx/domain';
import { toResolvedAgent } from '@projectx/ai-runtime';
import type { AgentContract } from '@projectx/shared';
import type { IAgentRegistry } from '@projectx/ai-runtime';

const conversationContract: AgentContract = {
  agentId: 'conversation-handler',
  name: 'Conversation Handler',
  role: 'reply-interpreter',
  description: 'Classifies prospect replies and decides the next best action',
  capabilities: ['classify-reply', 'suggest-next-action'],
  tools: [],
  policies: [],
  modelPolicy: {
    preferredModelFamily: 'deterministic',
    maxCostPerTaskUsd: 0,
    maxTokensPerTask: 0,
  },
  memoryPolicy: {
    read: ['conversation-history'],
    write: ['conversation-outcome'],
    validationRequired: true,
  },
  knowledgePolicy: {
    read: ['messaging-guidelines'],
    write: [],
  },
  autonomyLevelDefault: 2,
  evaluationPolicy: {
    criteria: ['confidence', 'policy-compliance'],
    minScore: 0.6,
  },
  lifecycle: 'ACTIVE',
  owner: 'system',
  version: '1.0.0',
  createdAt: new Date(),
  updatedAt: new Date(),
};

export class ConversationAgentRegistry implements IAgentRegistry {
  async getAgent(_ctx: TenantContext, agentId: string, _version?: string) {
    if (agentId !== 'conversation-handler') {
      return null;
    }
    return toResolvedAgent(conversationContract, 'stub.conversation.v1');
  }

  async getCapability(_tenantId: string, capabilityId: string): Promise<{ capabilityId: string; allowedTools: string[] } | null> {
    if (capabilityId === 'classify-reply') {
      return { capabilityId, allowedTools: [] };
    }
    if (capabilityId === 'suggest-next-action') {
      return { capabilityId, allowedTools: [] };
    }
    return null;
  }
}
