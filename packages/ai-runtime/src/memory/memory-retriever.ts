import type { TenantContext } from '@projectx/domain';
import type { IMemoryRetriever, MemoryEntry, MemoryQuery } from './memory-retriever.interface';

export interface MemoryStoreEntry extends MemoryEntry {
  readonly tenantId: string;
  readonly agentId: string;
  readonly authorized: boolean;
}

export class InMemoryMemoryRetriever implements IMemoryRetriever {
  private readonly store: MemoryStoreEntry[] = [];

  seed(entry: MemoryStoreEntry): void {
    this.store.push(entry);
  }

  async retrieve(ctx: TenantContext, query: MemoryQuery): Promise<MemoryEntry[]> {
    return this.store
      .filter(
        (entry) =>
          entry.tenantId === ctx.tenantId &&
          entry.agentId === query.agentId &&
          entry.authorized &&
          (query.types.length === 0 || query.types.includes(entry.type)),
      )
      .map(({ memoryId, type, content, relevance }) => ({ memoryId, type, content, relevance }));
  }
}
