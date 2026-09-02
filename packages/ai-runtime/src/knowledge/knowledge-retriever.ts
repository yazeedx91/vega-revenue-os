import type { TenantContext } from '@projectx/domain';
import type { IKnowledgeRetriever, KnowledgeEntry, KnowledgeQuery } from './knowledge-retriever.interface';

export interface KnowledgeStoreEntry extends KnowledgeEntry {
  readonly tenantId: string;
  readonly authorized: boolean;
  readonly freshness?: Date;
}

export class InMemoryKnowledgeRetriever implements IKnowledgeRetriever {
  private readonly store: KnowledgeStoreEntry[] = [];

  seed(entry: KnowledgeStoreEntry): void {
    this.store.push(entry);
  }

  async retrieve(ctx: TenantContext, query: KnowledgeQuery): Promise<KnowledgeEntry[]> {
    return this.store
      .filter(
        (entry) =>
          entry.tenantId === ctx.tenantId &&
          entry.authorized &&
          (entry.domain === query.domain || entry.domain === 'global'),
      )
      .map(({ knowledgeId, domain, content, relevance }) => ({ knowledgeId, domain, content, relevance }));
  }
}
