import {
  ContextAssembler,
  InMemoryMemoryRetriever,
  InMemoryKnowledgeRetriever,
} from '@projectx/ai-runtime';
import { asCorrelationId, asTenantId } from '@projectx/shared';
import { baseExecution, tenantId } from './fixtures';

const otherTenantId = asTenantId('tenant-2');

describe('ContextAssembler', () => {
  it('assembles tenant-scoped prompt context with memory and knowledge', async () => {
    const memory = new InMemoryMemoryRetriever();
    const knowledge = new InMemoryKnowledgeRetriever();

    memory.seed({
      memoryId: 'm-1',
      tenantId: tenantId as unknown as string,
      agentId: 'agent-1',
      type: 'working',
      content: 'Memory A',
      relevance: 0.9,
      authorized: true,
    });
    knowledge.seed({
      knowledgeId: 'k-1',
      tenantId: tenantId as unknown as string,
      domain: 'global',
      content: 'Knowledge A',
      relevance: 0.8,
      authorized: true,
    });

    const assembler = new ContextAssembler({ memoryRetriever: memory, knowledgeRetriever: knowledge });
    const request = baseExecution();
    const context = await assembler.assemble(
      { tenantId, correlationId: asCorrelationId('corr-1') },
      request,
    );

    expect(context.userMessage).toContain(request.taskType);
    expect(context.memoryContext).toContain('[working] Memory A');
    expect(context.knowledgeContext).toContain('[global] Knowledge A');
    expect(context.toolsAvailable).toContain('research');
  });

  it('does not include unauthorized memory entries', async () => {
    const memory = new InMemoryMemoryRetriever();
    const knowledge = new InMemoryKnowledgeRetriever();

    memory.seed({
      memoryId: 'm-1',
      tenantId: tenantId as unknown as string,
      agentId: 'agent-1',
      type: 'working',
      content: 'Sensitive memory',
      relevance: 0.9,
      authorized: false,
    });

    const assembler = new ContextAssembler({ memoryRetriever: memory, knowledgeRetriever: knowledge });
    const context = await assembler.assemble(
      { tenantId, correlationId: asCorrelationId('corr-1') },
      baseExecution(),
    );

    expect(context.memoryContext).toEqual([]);
  });

  it('rejects cross-tenant assembly', async () => {
    const memory = new InMemoryMemoryRetriever();
    const knowledge = new InMemoryKnowledgeRetriever();
    const assembler = new ContextAssembler({ memoryRetriever: memory, knowledgeRetriever: knowledge });

    await expect(
      assembler.assemble(
        { tenantId: otherTenantId, correlationId: asCorrelationId('corr-1') },
        baseExecution(),
      ),
    ).rejects.toThrow();
  });
});
