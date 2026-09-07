import { defineQuery, proxyActivities, setHandler } from '@temporalio/workflow';
import type {
  IngestKnowledgeActivityInput,
  ConsolidateMemoryActivityInput,
} from '../activities/memory-knowledge-activities';
import type { IngestKnowledgeResult, MemoryWriteResult } from '@projectx/ai-runtime';

const activityOptions = {
  // Ingestion can be slow (chunk + embed); allow a generous window but bound it.
  startToCloseTimeout: 300000,
  // Activities are idempotent via the caller-supplied idempotency key, so a
  // bounded retry is safe and never double-ingests.
  retry: { maximumAttempts: 3 },
};

type MemoryKnowledgeActivities = {
  ingestKnowledgeActivity(input: IngestKnowledgeActivityInput): Promise<IngestKnowledgeResult>;
  consolidateMemoryActivity(input: ConsolidateMemoryActivityInput): Promise<MemoryWriteResult>;
};

const { ingestKnowledgeActivity, consolidateMemoryActivity } =
  proxyActivities<MemoryKnowledgeActivities>(activityOptions);

export const ingestionStatusQuery = defineQuery<string>('ingestionStatus');
export const consolidationStatusQuery = defineQuery<string>('consolidationStatus');

export interface KnowledgeIngestionWorkflowInput extends IngestKnowledgeActivityInput {}
export interface MemoryConsolidationWorkflowInput extends ConsolidateMemoryActivityInput {}

/**
 * Durable knowledge ingestion workflow. The workflow id is derived from the
 * caller's idempotency key so a duplicate start is deduplicated by Temporal's
 * workflow-id reuse policy, and the activity itself dedups on the durable
 * ingestion_runs unique index — defense in depth for idempotency.
 */
export async function KnowledgeIngestionWorkflow(
  input: KnowledgeIngestionWorkflowInput,
): Promise<IngestKnowledgeResult> {
  let status = 'INGESTING';
  setHandler(ingestionStatusQuery, () => status);
  const result = await ingestKnowledgeActivity(input);
  status = result.status;
  return result;
}

/**
 * Durable memory consolidation workflow. Writes a candidate memory through the
 * write-policy gate (scrub, secret/CoT rejection, exact-profile embedding) with
 * the caller's idempotency key so retries never double-write.
 */
export async function MemoryConsolidationWorkflow(
  input: MemoryConsolidationWorkflowInput,
): Promise<MemoryWriteResult> {
  let status = 'CONSOLIDATING';
  setHandler(consolidationStatusQuery, () => status);
  const result = await consolidateMemoryActivity(input);
  status = result.decision;
  return result;
}
