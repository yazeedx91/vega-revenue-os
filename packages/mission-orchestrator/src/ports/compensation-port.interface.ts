import type { TenantContext } from '@projectx/domain';

export interface CompensationRecord {
  readonly compensationId: string;
  readonly missionId: string;
  readonly taskId?: string;
  readonly actionType: string;
  readonly payload: unknown;
}

export interface ICompensationPort {
  execute(ctx: TenantContext, record: CompensationRecord): Promise<void>;
}
