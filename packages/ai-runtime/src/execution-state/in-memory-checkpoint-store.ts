import type { ICheckpointStore } from './checkpoint-store.interface';
import type { ExecutionStateSnapshot } from './execution-state';

export class InMemoryCheckpointStore implements ICheckpointStore {
  private readonly snapshots = new Map<string, ExecutionStateSnapshot>();

  async save(snapshot: ExecutionStateSnapshot): Promise<void> {
    this.snapshots.set(snapshot.executionId, snapshot);
  }

  async load(executionId: string): Promise<ExecutionStateSnapshot | null> {
    return this.snapshots.get(executionId) ?? null;
  }
}
