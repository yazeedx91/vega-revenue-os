import type {
  ITemporalSignalDispatcher,
  TemporalSignalDispatchRequest,
  TemporalSignalDispatchResult,
} from '../../ports/temporal-signal-dispatcher.interface';

export interface RecordedSignalDispatch extends TemporalSignalDispatchRequest {
  readonly timestamp: Date;
}

export type FakeTemporalSignalDispatcherBehavior =
  | { type: 'dispatched' }
  | { type: 'workflow-not-found' }
  | { type: 'failed'; reason: string };

/**
 * Deterministic test double for `ITemporalSignalDispatcher`. Records every
 * dispatch attempt (workflowId, signalName, payload, tenantId,
 * correlationId, timestamp) for assertions, and never performs any real
 * network/Temporal call.
 */
export class FakeTemporalSignalDispatcher implements ITemporalSignalDispatcher {
  readonly dispatched: RecordedSignalDispatch[] = [];

  constructor(private readonly behavior: FakeTemporalSignalDispatcherBehavior = { type: 'dispatched' }) {}

  async dispatch(request: TemporalSignalDispatchRequest): Promise<TemporalSignalDispatchResult> {
    this.dispatched.push({ ...request, timestamp: new Date() });

    if (this.behavior.type === 'workflow-not-found') {
      return { outcome: 'WORKFLOW_NOT_FOUND', reason: `No running workflow for ${request.workflowId}` };
    }
    if (this.behavior.type === 'failed') {
      return { outcome: 'FAILED', reason: this.behavior.reason };
    }
    return { outcome: 'DISPATCHED' };
  }
}
