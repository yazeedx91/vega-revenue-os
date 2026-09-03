import { toResolvedAgent } from '@projectx/ai-runtime';
import type { IAgentRegistry } from '@projectx/ai-runtime';
import type { AgentContract } from '@projectx/shared';
import type { TenantContext } from '@projectx/domain';

export const OUTREACH_ORCHESTRATOR_AGENT_ID = 'outreach-orchestrator';

const outreachContract: AgentContract = {
  agentId: OUTREACH_ORCHESTRATOR_AGENT_ID,
  name: 'Outreach Orchestrator',
  role: 'outreach-coordinator',
  description: 'Plans, personalizes, and executes tenant-isolated outreach sequences.',
  capabilities: [
    'plan-outreach',
    'draft-message',
    'execute-send',
    'advance-sequence',
    'record-response',
    'await-response',
  ],
  tools: [],
  policies: [],
  modelPolicy: { preferredModelFamily: 'stub', maxCostPerTaskUsd: 1, maxTokensPerTask: 2000 },
  memoryPolicy: { read: [], write: [], validationRequired: false },
  knowledgePolicy: { read: [], write: [] },
  autonomyLevelDefault: 0.3,
  evaluationPolicy: { criteria: [], minScore: 0 },
  lifecycle: 'ACTIVE',
  owner: 'outreach',
  version: '1.0.0',
  createdAt: new Date(),
  updatedAt: new Date(),
};

export class OutreachAgentRegistry implements IAgentRegistry {
  async getAgent(_ctx: TenantContext, agentId: string, _version?: string) {
    if (agentId !== OUTREACH_ORCHESTRATOR_AGENT_ID) {
      return null;
    }
    return toResolvedAgent(outreachContract, 'stub.outreach.v1');
  }

  async getCapability(_tenantId: string, capabilityId: string): Promise<{ capabilityId: string; allowedTools: string[] } | null> {
    const capabilities: Record<string, string[]> = {
      'plan-outreach': [],
      'draft-message': [],
      'execute-send': [],
      'advance-sequence': [],
      'record-response': [],
      'await-response': [],
    };
    const tools = capabilities[capabilityId];
    if (!tools) return null;
    return { capabilityId, allowedTools: tools };
  }
}
