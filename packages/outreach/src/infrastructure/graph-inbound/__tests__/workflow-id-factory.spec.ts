import { WorkflowIdFactory } from '../workflow-id-factory';

describe('WorkflowIdFactory', () => {
  it('generates a deterministic id for the same tenant/sequence', () => {
    const first = WorkflowIdFactory.forOutreachSequence('tenant-a', 'seq-1');
    const second = WorkflowIdFactory.forOutreachSequence('tenant-a', 'seq-1');
    expect(first).toBe(second);
  });

  it('includes both tenantId and sequenceId, tenant-scoped', () => {
    const id = WorkflowIdFactory.forOutreachSequence('tenant-a', 'seq-1');
    expect(id).toContain('tenant-a');
    expect(id).toContain('seq-1');
  });

  it('produces different ids for different tenants with the same sequenceId', () => {
    const a = WorkflowIdFactory.forOutreachSequence('tenant-a', 'seq-1');
    const b = WorkflowIdFactory.forOutreachSequence('tenant-b', 'seq-1');
    expect(a).not.toBe(b);
  });

  it('produces different ids for different sequences within the same tenant', () => {
    const a = WorkflowIdFactory.forOutreachSequence('tenant-a', 'seq-1');
    const b = WorkflowIdFactory.forOutreachSequence('tenant-a', 'seq-2');
    expect(a).not.toBe(b);
  });
});
