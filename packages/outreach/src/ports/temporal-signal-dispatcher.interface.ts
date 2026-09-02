/**
 * Provider-neutral boundary for delivering a signal to a running workflow.
 * No Temporal SDK types cross this interface — only primitives — so
 * `packages/outreach`/`packages/conversation` never depend on
 * `@temporalio/*`. Phase 14 Milestone 6: exists so the inbound Graph reply
 * path can express "notify the workflow that owns this sequence" without
 * this package taking on a Temporal dependency. The real
 * `@temporalio/client`-backed adapter lives in `apps/temporal-worker` and is
 * deliberately not wired into any composition root yet — see the Milestone
 * 6 completion report for why (no workflow-start/addressing lifecycle
 * exists to make it operationally meaningful).
 */
export type TemporalSignalDispatchOutcome = 'DISPATCHED' | 'WORKFLOW_NOT_FOUND' | 'FAILED';

export interface TemporalSignalDispatchRequest {
  readonly workflowId: string;
  readonly signalName: string;
  readonly payload: Record<string, unknown>;
  readonly tenantId: string;
  readonly correlationId: string;
}

export interface TemporalSignalDispatchResult {
  readonly outcome: TemporalSignalDispatchOutcome;
  readonly reason?: string;
}

export interface ITemporalSignalDispatcher {
  dispatch(request: TemporalSignalDispatchRequest): Promise<TemporalSignalDispatchResult>;
}
