import { FakeTemporalSignalDispatcher } from '../fake-temporal-signal-dispatcher';
import { WorkflowIdFactory } from '../workflow-id-factory';

describe('FakeTemporalSignalDispatcher', () => {
  it('records exactly one dispatch with the correct workflowId/signalName/payload', async () => {
    const dispatcher = new FakeTemporalSignalDispatcher();
    const workflowId = WorkflowIdFactory.forOutreachSequence('tenant-a', 'seq-1');

    const result = await dispatcher.dispatch({
      workflowId,
      signalName: 'replyReceived',
      payload: { providerMessageId: 'graph-msg-1' },
      tenantId: 'tenant-a',
      correlationId: 'corr-1',
    });

    expect(result.outcome).toBe('DISPATCHED');
    expect(dispatcher.dispatched).toHaveLength(1);
    expect(dispatcher.dispatched[0]).toMatchObject({
      workflowId,
      signalName: 'replyReceived',
      payload: { providerMessageId: 'graph-msg-1' },
      tenantId: 'tenant-a',
      correlationId: 'corr-1',
    });
    expect(dispatcher.dispatched[0].timestamp).toBeInstanceOf(Date);
  });

  it('returns WORKFLOW_NOT_FOUND when configured to simulate a missing workflow', async () => {
    const dispatcher = new FakeTemporalSignalDispatcher({ type: 'workflow-not-found' });

    const result = await dispatcher.dispatch({
      workflowId: WorkflowIdFactory.forOutreachSequence('tenant-a', 'seq-1'),
      signalName: 'replyReceived',
      payload: {},
      tenantId: 'tenant-a',
      correlationId: 'corr-1',
    });

    expect(result.outcome).toBe('WORKFLOW_NOT_FOUND');
    // The attempt is still recorded even though no workflow existed.
    expect(dispatcher.dispatched).toHaveLength(1);
  });

  it('returns FAILED with a reason when configured to simulate a dispatch failure', async () => {
    const dispatcher = new FakeTemporalSignalDispatcher({ type: 'failed', reason: 'connection refused' });

    const result = await dispatcher.dispatch({
      workflowId: 'wf-1',
      signalName: 'replyReceived',
      payload: {},
      tenantId: 'tenant-a',
      correlationId: 'corr-1',
    });

    expect(result.outcome).toBe('FAILED');
    expect(result.reason).toBe('connection refused');
  });

  it('accumulates multiple dispatches for duplicate-signal assertions', async () => {
    const dispatcher = new FakeTemporalSignalDispatcher();
    const request = { workflowId: 'wf-1', signalName: 'replyReceived', payload: {}, tenantId: 'tenant-a', correlationId: 'corr-1' };

    await dispatcher.dispatch(request);
    await dispatcher.dispatch(request);

    expect(dispatcher.dispatched).toHaveLength(2);
  });
});
