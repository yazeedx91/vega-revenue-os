import type { TenantContext } from '@projectx/domain';
import type { AgentContract, CorrelationId, IdempotencyKey, MissionContract, PlanContract } from '@projectx/shared';

/**
 * Creates a plan of phases and tasks for a mission using available agents.
 */
export interface IPlanner {
  plan(ctx: TenantContext, request: PlanningRequest): Promise<PlanContract>;
}

export interface PlanningRequest {
  mission: MissionContract;
  availableAgents: AgentContract[];
  correlationId: CorrelationId;
  idempotencyKey?: IdempotencyKey;
  deadline?: Date;
  abortSignal?: AbortSignal;
}
