import type { ExecutionStateSnapshot } from './execution-state';

export interface ICheckpointStore {
  save(snapshot: ExecutionStateSnapshot): Promise<void>;
  load(executionId: string): Promise<ExecutionStateSnapshot | null>;
}
