import type { TenantContext } from '@projectx/domain';
import type { CompensationRecord, ICompensationPort } from '../ports/compensation-port.interface';

export class InMemoryCompensationAdapter implements ICompensationPort {
  readonly executed: CompensationRecord[] = [];

  async execute(_ctx: TenantContext, record: CompensationRecord): Promise<void> {
    this.executed.push(record);
  }

  clear(): void {
    this.executed.length = 0;
  }
}
