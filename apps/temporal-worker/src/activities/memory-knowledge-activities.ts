import type { TenantContext } from '@projectx/domain';
import type { TenantId, CorrelationId } from '@projectx/shared';
import type {
  KnowledgeIngestionService,
  IngestKnowledgeRequest,
  IngestKnowledgeResult,
  MemoryWritePolicyService,
  MemoryWriteRequest,
  MemoryWriteResult,
} from '@projectx/ai-runtime';

/**
 * Temporal activities for Slice 7 durable memory + knowledge. The concrete
 * services are injected via the setters below at worker startup (composition
 * root), keeping this module free of construction logic so it can be exercised
 * by tests with fakes and by the worker with the real Postgres-backed services.
 *
 * Idempotency: each activity forwards the caller-supplied idempotency key into
 * the underlying service, which dedups on the durable unique index — so a
 * Temporal retry/replay never double-ingests or double-writes.
 */

let ingestionService: KnowledgeIngestionService | undefined;
let writePolicy: MemoryWritePolicyService | undefined;

export function setKnowledgeIngestionService(service: KnowledgeIngestionService): void {
  ingestionService = service;
}

export function setMemoryWritePolicy(service: MemoryWritePolicyService): void {
  writePolicy = service;
}

export interface IngestKnowledgeActivityInput {
  readonly tenantId: string;
  readonly correlationId: string;
  readonly userId?: string;
  readonly request: IngestKnowledgeRequest;
}

export interface ConsolidateMemoryActivityInput {
  readonly tenantId: string;
  readonly correlationId: string;
  readonly userId?: string;
  readonly request: MemoryWriteRequest;
}

function toContext(input: { tenantId: string; correlationId: string; userId?: string }): TenantContext {
  return {
    tenantId: input.tenantId as TenantId,
    correlationId: input.correlationId as CorrelationId,
    userId: input.userId,
  };
}

export async function ingestKnowledgeActivity(
  input: IngestKnowledgeActivityInput,
): Promise<IngestKnowledgeResult> {
  if (!ingestionService) {
    throw new Error('KnowledgeIngestionService not initialised; call setKnowledgeIngestionService at worker startup');
  }
  return ingestionService.ingest(toContext(input), input.request);
}

export async function consolidateMemoryActivity(
  input: ConsolidateMemoryActivityInput,
): Promise<MemoryWriteResult> {
  if (!writePolicy) {
    throw new Error('MemoryWritePolicyService not initialised; call setMemoryWritePolicy at worker startup');
  }
  return writePolicy.write(toContext(input), input.request);
}
