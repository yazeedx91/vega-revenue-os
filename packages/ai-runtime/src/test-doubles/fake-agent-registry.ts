import type { TenantContext } from '@projectx/domain';
import type { TenantId } from '@projectx/shared';
import type { AgentContract } from '@projectx/shared';
import type { IAgentRegistry } from '../agent-executor/agent-registry.interface';

export class FakeAgentRegistry implements IAgentRegistry {
  private readonly agents = new Map<string, AgentContract>();

  register(tenantId: TenantId, agent: AgentContract): void {
    this.agents.set(`${tenantId}:${agent.agentId}`, agent);
  }

  async getAgent(
    ctx: TenantContext,
    agentId: string,
    _version?: string,
  ): Promise<AgentContract | null> {
    const key = `${ctx.tenantId}:${agentId}`;
    return this.agents.get(key) ?? null;
  }

  async getCapability(
    _tenantId: string,
    capabilityId: string,
  ): Promise<{ capabilityId: string; allowedTools: string[] } | null> {
    return { capabilityId, allowedTools: [] };
  }
}
