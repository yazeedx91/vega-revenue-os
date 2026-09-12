import { Connection } from '@temporalio/client';
import { TemporalWorkflowClient } from '../temporal-workflow-client';

describe('TemporalWorkflowClient', () => {
  let connectSpy: jest.SpyInstance;

  beforeEach(() => {
    connectSpy = jest.spyOn(Connection, 'connect').mockResolvedValue({
      close: jest.fn(),
    } as unknown as Connection);
  });

  afterEach(() => {
    connectSpy.mockRestore();
  });

  it('uses apiKey and enables TLS when an API key is configured', async () => {
    const client = new TemporalWorkflowClient({
      address: 'quickstart-projectx-test.rpxgu.tmprl.cloud:7233',
      namespace: 'quickstart-projectx-test.rpxgu',
      apiKey: 'test-api-key',
    });

    await expect(client.start({ tenantId: 't', correlationId: 'c' } as any, 'MissionWorkflow', {}, { workflowId: 'wf-1' })).rejects.toThrow();

    expect(connectSpy).toHaveBeenCalledTimes(1);
    const options = connectSpy.mock.calls[0][0];
    expect(options.address).toBe('quickstart-projectx-test.rpxgu.tmprl.cloud:7233');
    expect(options.apiKey).toBe('test-api-key');
    expect(options.tls).toBe(true);
  });

  it('preserves local self-hosted behavior when no API key is configured', async () => {
    const client = new TemporalWorkflowClient({
      address: 'localhost:7233',
      namespace: 'default',
    });

    await expect(client.start({ tenantId: 't', correlationId: 'c' } as any, 'MissionWorkflow', {}, { workflowId: 'wf-1' })).rejects.toThrow();

    expect(connectSpy).toHaveBeenCalledTimes(1);
    const options = connectSpy.mock.calls[0][0];
    expect(options.address).toBe('localhost:7233');
    expect(options.apiKey).toBeUndefined();
    expect(options.tls).toBeUndefined();
  });

  it('does not log the API key', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();

    const client = new TemporalWorkflowClient({
      address: 'quickstart-projectx-test.rpxgu.tmprl.cloud:7233',
      namespace: 'quickstart-projectx-test.rpxgu',
      apiKey: 'sensitive-api-key',
    });

    try {
      await client.start({ tenantId: 't', correlationId: 'c' } as any, 'MissionWorkflow', {}, { workflowId: 'wf-1' });
    } catch {
      // expected to fail because Client is mocked
    }

    const calls = [
      ...logSpy.mock.calls,
      ...warnSpy.mock.calls,
      ...errorSpy.mock.calls,
    ];
    const leaked = calls.some((call) =>
      call.some((arg) => typeof arg === 'string' && arg.includes('sensitive-api-key')),
    );
    expect(leaked).toBe(false);

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
