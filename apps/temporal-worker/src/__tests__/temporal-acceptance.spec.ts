import { WorkflowClient } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './test-activities';

const DEFAULT_TEMPORAL_ADDRESS = 'localhost:7234';

async function isReachable(address: string): Promise<boolean> {
  try {
    const connection = await NativeConnection.connect({ address });
    await connection.close();
    return true;
  } catch {
    return false;
  }
}

describe('Temporal integration acceptance', () => {
  let connection: NativeConnection | undefined;
  let worker: Worker | undefined;
  let workerRun: Promise<void> | undefined;
  let client: WorkflowClient;
  const address = process.env.TEMPORAL_ADDRESS ?? DEFAULT_TEMPORAL_ADDRESS;
  const taskQueue = `acceptance-${Date.now()}`;

  beforeAll(async () => {
    if (!(await isReachable(address))) {
      // eslint-disable-next-line no-console
      console.warn(`Skipping Temporal acceptance tests: ${address} unreachable`);
      return;
    }
    connection = await NativeConnection.connect({ address });
    client = new WorkflowClient({ connection });

    worker = await Worker.create({
      connection,
      taskQueue,
      workflowsPath: require.resolve('./test-workflow'),
      activities,
    });
    // Start worker in the background; failures will surface in the afterAll hook or test assertions.
    workerRun = worker.run().catch(() => {});
  }, 60_000);

  afterAll(async () => {
    worker?.shutdown();
    if (workerRun) {
      await workerRun;
    }
    await connection?.close();
  });

  it('runs a deterministic workflow end-to-end', async () => {
    if (!connection) return;
    const handle = await client.start('acceptanceTestWorkflow', {
      taskQueue,
      workflowId: `acceptance-deterministic-${Date.now()}`,
      args: ['hello'],
    });
    const result = await handle.result();
    expect(result).toBe('echo:hello');
  }, 30_000);
});
