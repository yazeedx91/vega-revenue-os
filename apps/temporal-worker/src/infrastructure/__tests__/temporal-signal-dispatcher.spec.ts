import { TemporalSignalDispatcher } from '../temporal-signal-dispatcher';

describe('TemporalSignalDispatcher', () => {
  it('can be constructed without making any live Temporal network call', () => {
    // Construction alone must not attempt a connection — the client is
    // established lazily on the first dispatch() call, and `Connection.connect`
    // is deliberately never invoked here (no live Temporal server exists in
    // this environment; see the Milestone 6 completion report).
    expect(() => new TemporalSignalDispatcher()).not.toThrow();
    expect(() => new TemporalSignalDispatcher({ address: 'localhost:7233', namespace: 'default' })).not.toThrow();
  });
});
