import { Account, TenantIsolationError, AuthorizationError } from '@projectx/domain';
import { asTenantId, asAccountId, asCorrelationId, asEventId } from '@projectx/shared';
import type { AccountRepositoryContext } from '@projectx/infrastructure';
import { InMemoryAccountRepository } from '../infrastructure/in-memory-intelligence-repositories';

function makeCtx(tenantId: string, workspaceId: string): AccountRepositoryContext {
  return {
    tenantId: asTenantId(tenantId),
    correlationId: asCorrelationId('corr-1'),
    workspaceId,
  };
}

function makeAccount(tenantId: string, workspaceId: string, id: string, status?: string): Account {
  return Account.create(
    {
      id: asAccountId(id),
      tenantId: asTenantId(tenantId),
      workspaceId,
      name: `Account ${id}`,
      domain: `${id}.example.com`,
      status: (status as any) ?? 'DISCOVERED',
    },
    asCorrelationId('corr-1'),
    asEventId('evt-1'),
  );
}

describe('InMemoryAccountRepository workspace isolation', () => {
  let repo: InMemoryAccountRepository;

  beforeEach(() => {
    repo = new InMemoryAccountRepository();
  });

  it('same workspace read succeeds', async () => {
    const ctx = makeCtx('t1', 'ws-1');
    const account = makeAccount('t1', 'ws-1', 'acc-1');
    await repo.save(ctx, account);

    const found = await repo.findById(ctx, 'acc-1');
    expect(found).not.toBeNull();
    expect(found!.id).toBe('acc-1');
    expect(found!.workspaceId).toBe('ws-1');
  });

  it('same tenant / wrong workspace returns null', async () => {
    const ctx1 = makeCtx('t1', 'ws-1');
    const ctx2 = makeCtx('t1', 'ws-2');
    const account = makeAccount('t1', 'ws-1', 'acc-a');
    await repo.save(ctx1, account);

    const found = await repo.findById(ctx2, 'acc-a');
    expect(found).toBeNull();
  });

  it('findQualified scoped to workspace', async () => {
    const ctx1 = makeCtx('t1', 'ws-1');
    const ctx2 = makeCtx('t1', 'ws-2');
    const a1 = makeAccount('t1', 'ws-1', 'acc-q1', 'QUALIFIED');
    const a2 = makeAccount('t1', 'ws-2', 'acc-q2', 'QUALIFIED');
    await repo.save(ctx1, a1);
    await repo.save(ctx2, a2);

    const qualified1 = await repo.findQualified(ctx1);
    expect(qualified1).toHaveLength(1);
    expect(qualified1[0].id).toBe('acc-q1');

    const qualified2 = await repo.findQualified(ctx2);
    expect(qualified2).toHaveLength(1);
    expect(qualified2[0].id).toBe('acc-q2');
  });

  it('save with workspace mismatch fails closed and repo is unchanged', async () => {
    const correctCtx = makeCtx('t1', 'ws-1');
    const wrongCtx = makeCtx('t1', 'ws-2');
    const account = makeAccount('t1', 'ws-1', 'acc-ws-mismatch');

    await expect(repo.save(wrongCtx, account)).rejects.toThrow(AuthorizationError);

    const afterCorrect = await repo.findById(correctCtx, 'acc-ws-mismatch');
    expect(afterCorrect).toBeNull();

    const afterWrong = await repo.findById(wrongCtx, 'acc-ws-mismatch');
    expect(afterWrong).toBeNull();
  });

  it('save with tenant mismatch fails closed and repo is unchanged', async () => {
    const correctCtx = makeCtx('t1', 'ws-1');
    const wrongCtx = makeCtx('t2', 'ws-1');
    const account = makeAccount('t1', 'ws-1', 'acc-t-mismatch');

    await expect(repo.save(wrongCtx, account)).rejects.toThrow(TenantIsolationError);

    const afterCorrect = await repo.findById(correctCtx, 'acc-t-mismatch');
    expect(afterCorrect).toBeNull();

    const afterWrong = await repo.findById(wrongCtx, 'acc-t-mismatch');
    expect(afterWrong).toBeNull();
  });
});
