import type { Pool } from 'pg';
import { asCorrelationId, asIdempotencyKey, asTenantId } from '@projectx/shared';
import type { TenantContext } from '@projectx/domain';
import { FakePgPool } from '../testing/fake-pg-pool';
import { PostgresIdempotencyStore } from '../idempotency/postgres-idempotency-store';
import { InMemoryIdempotencyStore } from '../testing/in-memory-idempotency-store';
import type { IIdempotencyStore } from '../idempotency/idempotency-store.interface';

function ctxFor(tenantId: string): TenantContext {
  return { tenantId: asTenantId(tenantId), correlationId: asCorrelationId('corr-1') };
}

/**
 * Runs the same behavioral contract against both IIdempotencyStore
 * implementations, proving the atomic claim() fix (Phase 14 Milestone 4,
 * closing the Milestone 5 TOCTOU open risk) behaves identically regardless
 * of backing store.
 */
describe.each<{ name: string; makeStore: () => IIdempotencyStore }>([
  { name: 'InMemoryIdempotencyStore', makeStore: () => new InMemoryIdempotencyStore() },
  { name: 'PostgresIdempotencyStore (FakePgPool)', makeStore: () => new PostgresIdempotencyStore({ pool: new FakePgPool() as unknown as Pool }) },
])('$name — atomic claim()', ({ makeStore }) => {
  const ctx = ctxFor('tenant-a');
  const scope = 'outreach:send';
  const key = asIdempotencyKey('idmp-1');

  it('first claim on a fresh key succeeds', async () => {
    const store = makeStore();
    const result = await store.claim(ctx, scope, key);
    expect(result.claimed).toBe(true);
    expect(result.existing).toBeUndefined();
  });

  it('a second claim on an already-claimed key fails and returns the existing record', async () => {
    const store = makeStore();
    await store.claim(ctx, scope, key);

    const second = await store.claim(ctx, scope, key);

    expect(second.claimed).toBe(false);
    expect(second.existing).toBeDefined();
    expect(second.existing!.status).toBe('PENDING');
  });

  it('a claim on a key already marked COMPLETED via set() fails', async () => {
    const store = makeStore();
    await store.set(ctx, scope, key, { executionId: 'exec-1' }, { status: 'COMPLETED' });

    const result = await store.claim(ctx, scope, key);

    expect(result.claimed).toBe(false);
    expect(result.existing?.status).toBe('COMPLETED');
  });

  it('claims are tenant-scoped: the same key claimed under a different tenant does not conflict', async () => {
    const store = makeStore();
    const claimA = await store.claim(ctxFor('tenant-a'), scope, key);
    const claimB = await store.claim(ctxFor('tenant-b'), scope, key);

    expect(claimA.claimed).toBe(true);
    expect(claimB.claimed).toBe(true);
  });

  it('claims are scope-scoped: the same key claimed under a different scope does not conflict', async () => {
    const store = makeStore();
    const claimA = await store.claim(ctx, 'outreach:send', key);
    const claimB = await store.claim(ctx, 'some-other-scope', key);

    expect(claimA.claimed).toBe(true);
    expect(claimB.claimed).toBe(true);
  });

  it('an expired PENDING claim is never automatically re-claimed', async () => {
    const store = makeStore();
    const first = await store.claim(ctx, scope, key, { ttlSeconds: -1 });
    expect(first.claimed).toBe(true);

    const second = await store.claim(ctx, scope, key);
    expect(second.claimed).toBe(false);
    expect(second.existing?.status).toBe('PENDING');
  });

  it('an expired FAILED claim with submitted=false may be safely re-claimed', async () => {
    const store = makeStore();
    await store.set(ctx, scope, key, { submitted: false, reason: 'provider unavailable' }, { status: 'FAILED' });

    const claim = await store.claim(ctx, scope, key);
    expect(claim.claimed).toBe(true);
  });

  it('an expired FAILED claim with submitted=true cannot be re-claimed', async () => {
    const store = makeStore();
    await store.set(ctx, scope, key, { submitted: true, providerMessageId: 'prior-msg-1' }, { status: 'FAILED' });

    const claim = await store.claim(ctx, scope, key);
    expect(claim.claimed).toBe(false);
    expect(claim.existing?.status).toBe('FAILED');
  });

  it('exactly one of two concurrent claims on the same fresh key wins (TOCTOU regression)', async () => {
    const store = makeStore();

    const [a, b] = await Promise.all([store.claim(ctx, scope, key), store.claim(ctx, scope, key)]);

    const outcomes = [a.claimed, b.claimed].sort();
    expect(outcomes).toEqual([false, true]);
  });
});
