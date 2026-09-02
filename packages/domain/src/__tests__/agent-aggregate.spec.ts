import { Actor } from '../actor/actor';
import { Agent } from '../agent/agent';
import { Capability } from '../agent/capability';
import {
  asAgentId,
  asCapabilityId,
  asCorrelationId,
  asEventId,
  asPolicyId,
  asTenantId,
  asUserId,
} from '@projectx/shared';

function makeCapability(id = 'ResearchCompany') {
  return new Capability(
    asCapabilityId(id),
    'Research Company',
    'Discovers and enriches companies',
    'LOW',
    ['SearchWeb'],
    ['SourcePolicy'],
  );
}

function makeAgent(tenantId = asTenantId('tenant-1')) {
  const result = Agent.create(
    {
      id: asAgentId('agent-1'),
      tenantId,
      name: 'Research Agent',
      role: 'Research',
      description: 'Discovers companies',
      capabilities: [makeCapability()],
      tools: ['SearchWeb'],
      policies: [{ policyId: asPolicyId('policy-1'), version: '1.0.0' }],
      modelPolicy: { preferredModelFamily: 'gpt-4o', maxCostPerTaskUsd: 0.1, maxTokensPerTask: 5000 },
      memoryPolicy: { read: [], write: [], validationRequired: true },
      knowledgePolicy: { read: [], write: [] },
      autonomyLevelDefault: 3,
      evaluationPolicy: { criteria: ['accuracy'], minScore: 0.75 },
      owner: 'platform-team',
    },
    Actor.system('scheduler', tenantId),
    asCorrelationId('corr-1'),
    asEventId('event-1'),
  );
  if (!result.success) {
    throw new Error(result.error.message);
  }
  return result.value;
}

describe('Agent aggregate lifecycle', () => {
  it('creates an agent and emits AgentCreated', () => {
    const agent = makeAgent();
    expect(agent.lifecycle).toBe('DRAFT');
    expect(agent.domainEvents[0]?.eventType).toBe('AgentCreated');
  });

  it('rejects creation without capabilities', () => {
    const result = Agent.create(
      {
        id: asAgentId('agent-1'),
        tenantId: asTenantId('tenant-1'),
        name: 'Bad Agent',
        role: 'Research',
        description: 'No capabilities',
        capabilities: [],
        tools: [],
        policies: [],
        modelPolicy: { preferredModelFamily: 'gpt-4o', maxCostPerTaskUsd: 0.1, maxTokensPerTask: 5000 },
        memoryPolicy: { read: [], write: [], validationRequired: true },
        knowledgePolicy: { read: [], write: [] },
        autonomyLevelDefault: 3,
        evaluationPolicy: { criteria: [], minScore: 0 },
        owner: 'platform-team',
      },
      Actor.system('scheduler', asTenantId('tenant-1')),
      asCorrelationId('corr-1'),
      asEventId('event-1'),
    );
    expect(result.success).toBe(false);
  });

  it('registers capabilities and publishes immutable versions', () => {
    const agent = makeAgent();
    const cap = makeCapability('EnrichContact');
    expect(agent.registerCapability(cap, asCorrelationId('c2'), asEventId('e2')).success).toBe(true);
    expect(agent.capabilities.length).toBe(2);

    expect(agent.publishVersion('1.0.0', asCorrelationId('c3'), asEventId('e3')).success).toBe(true);
    expect(agent.currentVersion).toBe('1.0.0');

    expect(agent.publishVersion('1.0.0', asCorrelationId('c4'), asEventId('e4')).success).toBe(false);
  });

  it('activates and deactivates', () => {
    const agent = makeAgent();
    expect(agent.activate(asCorrelationId('c2'), asEventId('e2')).success).toBe(true);
    expect(agent.lifecycle).toBe('ACTIVE');

    expect(agent.deactivate(asCorrelationId('c3'), asEventId('e3')).success).toBe(true);
    expect(agent.lifecycle).toBe('DEPRECATED');
  });
});
