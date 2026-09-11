import { NotFoundException } from '@nestjs/common';
import type { Pool } from 'pg';
import { asCorrelationId, asTenantId } from '@projectx/shared';
import { ResourceIdPipe } from './resource-id.pipe';
import { OperatorApiService } from './operator-api.service';

class ScopedPool {
  readonly calls: Array<{ sql: string; params?: unknown[] }> = [];
  constructor(private readonly row?: Record<string, unknown>) {}
  async connect() {
    return {
      query: async (sql: string, params?: unknown[]) => {
        this.calls.push({ sql, params });
        if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
        return { rows: this.row ? [this.row] : [], rowCount: this.row ? 1 : 0 };
      },
      release: () => undefined,
    };
  }
}

const ctx = { tenantId: asTenantId('tenant-a'), workspaceId: 'workspace-a', correlationId: asCorrelationId('operator-test') };

describe('OperatorApiService workspace-scoped resource queries', () => {
  it.each(['../escape', '', 'x'.repeat(513), 'id with spaces'])('rejects malformed resource ID %s safely', (id) => {
    expect(() => new ResourceIdPipe().transform(id)).toThrow('Invalid resource ID');
  });

  it.each([
    ['Lead', 'lead', 'lead-1'],
    ['Campaign', 'campaign', 'campaign-1'],
    ['Sequence', 'sequence', 'sequence-1'],
    ['MessageExecution', 'execution', 'execution-1'],
    ['Conversation', 'conversation', 'conversation-1'],
    ['Approval', 'approval', 'approval-1'],
  ])('loads %s only with trusted tenant and workspace', async (_name, method, id) => {
    const pool = new ScopedPool({ id, state: {} });
    const service = new OperatorApiService(pool as unknown as Pool);
    await (service[method as keyof OperatorApiService] as any)(ctx, id);
    const query = pool.calls.find((call) => call.params?.[2] === id);
    expect(query?.params).toEqual([ctx.tenantId, ctx.workspaceId, id]);
    expect(query?.sql).toContain('workspace_id=$2');
  });

  it('returns a stable 404 for inaccessible resources without an existence oracle', async () => {
    const service = new OperatorApiService(new ScopedPool() as unknown as Pool);
    await expect(service.campaign({ ...ctx, workspaceId: 'workspace-b' }, 'campaign-a')).rejects.toThrow(NotFoundException);
  });

  it('does not select protected recipient ciphertext or fingerprints', async () => {
    const pool = new ScopedPool({ id: 'execution-1', state: {} });
    const service = new OperatorApiService(pool as unknown as Pool);
    await service.execution(ctx, 'execution-1');
    const sql = pool.calls.find((call) => call.params?.[2] === 'execution-1')!.sql;
    expect(sql).not.toMatch(/SELECT[^]*recipient_ciphertext/i);
    expect(sql).not.toMatch(/SELECT[^]*recipient_fingerprint/i);
  });
});
