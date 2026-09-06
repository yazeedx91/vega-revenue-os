import { proxyActivities } from '@temporalio/workflow';

/**
 * Slice 6 claim [17] — test-only workflow that exercises the REAL production
 * governed tool path through a Temporal activity:
 *   workflow -> activity -> AgentExecutor -> ToolExecutor -> ToolGateway
 *   -> real HttpToolProvider -> local deterministic HTTP server.
 *
 * The workflow itself is deterministic: it only delegates to the activity
 * (non-deterministic provider/DB work stays inside the activity, never in
 * workflow code). The activity is supplied by the spec and closes over the
 * real production chain built in the test harness.
 */

export interface GovernedToolCallArgs {
  tenantId: string;
  correlationId: string;
  executionId: string;
  missionId: string;
  agentId: string;
  agentVersion: string;
  taskId: string;
  idempotencyKey: string;
  toolId: string;
  toolVersion: string;
  route: string;
  input: Record<string, unknown>;
  autonomyLevel: number;
}

// Result is the AIExecutionResult serialized over the Temporal boundary.
export interface GovernedToolCallResult {
  status: string;
  executionId: string;
  outcome?: { summary?: string };
}

const { runGovernedToolCall } = proxyActivities<{
  runGovernedToolCall(args: GovernedToolCallArgs): Promise<GovernedToolCallResult>;
}>({ startToCloseTimeout: '2 minutes' });

export async function slice6ToolWorkflow(args: GovernedToolCallArgs): Promise<GovernedToolCallResult> {
  return runGovernedToolCall(args);
}
