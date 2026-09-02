import type { Pool } from 'pg';
import { AggregateRoot, DomainEvent } from '@projectx/domain';
import type { TenantContext } from '@projectx/domain';
import { asCorrelationId, asEventId, asTenantId, type EventId, type TenantId } from '@projectx/shared';
import { FakePgPool } from '../testing/fake-pg-pool';
import { PostgresRepository, type AggregateMapper } from '../persistence/postgres-repository';
import { ConcurrencyConflictError } from '../persistence/concurrency-conflict.error';
import { TenantIsolationError } from '@projectx/domain';

class TestEvent extends DomainEvent<{ note: string }> {
  constructor(eventId: EventId, tenantId: TenantId, correlationId: ReturnType<typeof asCorrelationId>, note: string) {
    super(eventId, 'TestEvent', '1.0', new Date(), tenantId, correlationId, 'test', { note });
  }
}

class TestAggregate extends AggregateRoot<string> {
  public note: string;

  private constructor(tenantId: TenantId, id: string, note: string) {
    super(tenantId, id);
    this.note = note;
  }

  static create(tenantId: TenantId, id: string, note: string): TestAggregate {
    const agg = new TestAggregate(tenantId, id, note);
    agg.applyEvent(new TestEvent(asEventId('evt-1'), tenantId, asCorrelationId('corr-1'), note));
    return agg;
  }

  static reconstitute(tenantId: TenantId, id: string, note: string, version: number): TestAggregate {
    const agg = new TestAggregate(tenantId, id, note);
    agg.setVersion(version);
    agg.clearDomainEvents();
    return agg;
  }

  changeNote(note: string): void {
    this.note = note;
    this.applyEvent(new TestEvent(asEventId('evt-n'), this.tenantId, asCorrelationId('corr-n'), note));
  }
}

type TestSnapshot = { note: string };

const mapper: AggregateMapper<TestAggregate, TestSnapshot, string> = {
  toSnapshot: (entity) => ({ note: entity.note }),
  fromSnapshot: (snapshot, id, tenantId, version) =>
    TestAggregate.reconstitute(tenantId as TenantId, id, snapshot.note, version),
};

function ctxFor(tenantId: string): TenantContext {
  return { tenantId: asTenantId(tenantId), correlationId: asCorrelationId('corr-1') };
}

function makeRepo(pool: FakePgPool): PostgresRepository<TestAggregate, TestSnapshot, string> {
  return new PostgresRepository<TestAggregate, TestSnapshot, string>(
    { pool: pool as unknown as Pool, tableName: 'test.aggregates' },
    mapper,
  );
}

describe('PostgresRepository', () => {
  it('inserts a freshly created aggregate and reloads it with identical state', async () => {
    const pool = new FakePgPool();
    const repo = makeRepo(pool);
    const ctx = ctxFor('tenant-1');

    const agg = TestAggregate.create(ctx.tenantId, 'agg-1', 'hello');
    await repo.save(ctx, agg);

    const reloaded = await repo.findById(ctx, 'agg-1');
    expect(reloaded).not.toBeNull();
    expect(reloaded!.note).toBe('hello');
    expect(reloaded!.version).toBe(agg.version);
  });

  it('rejects inserting a duplicate id as a concurrency conflict', async () => {
    const pool = new FakePgPool();
    const repo = makeRepo(pool);
    const ctx = ctxFor('tenant-1');

    const agg1 = TestAggregate.create(ctx.tenantId, 'agg-dup', 'first');
    await repo.save(ctx, agg1);

    const agg2 = TestAggregate.create(ctx.tenantId, 'agg-dup', 'second');
    await expect(repo.save(ctx, agg2)).rejects.toBeInstanceOf(ConcurrencyConflictError);
  });

  it('updates successfully when the expected version matches (real optimistic concurrency)', async () => {
    const pool = new FakePgPool();
    const repo = makeRepo(pool);
    const ctx = ctxFor('tenant-1');

    const agg = TestAggregate.create(ctx.tenantId, 'agg-2', 'v1');
    await repo.save(ctx, agg);

    const loaded = await repo.findById(ctx, 'agg-2');
    loaded!.changeNote('v2');
    await repo.save(ctx, loaded!);

    const reloaded = await repo.findById(ctx, 'agg-2');
    expect(reloaded!.note).toBe('v2');
  });

  it('allows saving the same in-memory aggregate again after a successful save (loadedVersion advances)', async () => {
    const pool = new FakePgPool();
    const repo = makeRepo(pool);
    const ctx = ctxFor('tenant-1');

    const agg = TestAggregate.create(ctx.tenantId, 'agg-resave', 'v1');
    await repo.save(ctx, agg);

    agg.changeNote('v2');
    await expect(repo.save(ctx, agg)).resolves.toBeUndefined();

    const reloaded = await repo.findById(ctx, 'agg-resave');
    expect(reloaded!.note).toBe('v2');
    expect(reloaded!.version).toBe(agg.version);
  });

  it('rejects a stale-version update as a concurrency conflict (two loaders, one writer wins)', async () => {
    const pool = new FakePgPool();
    const repo = makeRepo(pool);
    const ctx = ctxFor('tenant-1');

    const agg = TestAggregate.create(ctx.tenantId, 'agg-3', 'initial');
    await repo.save(ctx, agg);

    const loaderA = await repo.findById(ctx, 'agg-3');
    const loaderB = await repo.findById(ctx, 'agg-3');

    loaderA!.changeNote('from-a');
    await repo.save(ctx, loaderA!);

    loaderB!.changeNote('from-b');
    await expect(repo.save(ctx, loaderB!)).rejects.toBeInstanceOf(ConcurrencyConflictError);

    const finalState = await repo.findById(ctx, 'agg-3');
    expect(finalState!.note).toBe('from-a');
  });

  it('scopes reads by tenant_id and does not return another tenant\'s row', async () => {
    const pool = new FakePgPool();
    const repo = makeRepo(pool);

    const ownerCtx = ctxFor('tenant-owner');
    const agg = TestAggregate.create(ownerCtx.tenantId, 'shared-id', 'owner-data');
    await repo.save(ownerCtx, agg);

    const otherCtx = ctxFor('tenant-other');
    const result = await repo.findById(otherCtx, 'shared-id');
    expect(result).toBeNull();
  });

  it('scopes reads by tenant_id correctly (sanity check for the WHERE-clause path)', async () => {
    const pool = new FakePgPool();
    const repo = makeRepo(pool);
    const ctx = ctxFor('tenant-1');

    pool.seedRow('test.aggregates', {
      tenant_id: 'tenant-1',
      id: 'cross-tenant-row',
      payload: { note: 'leaked' },
      version: 0,
      updated_at: new Date(),
    });

    const result = await repo.findById(ctx, 'cross-tenant-row');
    expect(result).not.toBeNull();
  });

  it('throws TenantIsolationError if the driver somehow returns a row for a different tenant than requested (defense-in-depth)', async () => {
    // A real WHERE tenant_id = $1 clause (plus RLS) makes this scenario impossible in
    // practice, so we stub the raw pg.Pool boundary directly to simulate a hypothetical
    // query-builder or RLS-policy misconfiguration bug, and assert the repository's own
    // defensive assertion catches it rather than silently returning cross-tenant data.
    const mismatchedRow = {
      tenant_id: 'tenant-mismatch',
      id: 'corrupted-row',
      payload: { note: 'leaked' },
      version: 0,
    };
    const stubPool = {
      connect: async () => ({
        query: async (sql: string, params: unknown[] = []) => {
          if (sql.includes("set_config('app.current_tenant'")) {
            return { rows: [], rowCount: 1 };
          }
          if (/^SELECT/i.test(sql.trim())) {
            return { rows: [mismatchedRow], rowCount: 1 };
          }
          throw new Error(`unexpected query in stub: ${sql}`);
        },
        release: () => {},
      }),
    };
    const repo = makeRepo(stubPool as unknown as FakePgPool);
    const ctx = ctxFor('tenant-1');

    await expect(repo.findById(ctx, 'corrupted-row')).rejects.toBeInstanceOf(TenantIsolationError);
  });
});
