import { createClient, type RedisClientType } from 'redis';
import { asCorrelationId, asIdempotencyKey, asTenantId } from '@projectx/shared';
import { RedisCache, RedisRateLimiter } from '../cache/redis-cache';

const DEFAULT_REDIS_URL = 'redis://localhost:6380';

async function isReachable(url: string): Promise<boolean> {
  const client = createClient({ url });
  try {
    await client.connect();
    await client.ping();
    return true;
  } catch {
    return false;
  } finally {
    await client.disconnect().catch(() => {});
  }
}

function ctx(tenantId: string) {
  return { tenantId: asTenantId(tenantId), correlationId: asCorrelationId('acceptance-test') };
}

describe('Redis integration acceptance', () => {
  let client: RedisClientType;
  let cache: RedisCache;
  let rateLimiter: RedisRateLimiter;
  let url: string;

  beforeAll(async () => {
    url = process.env.REDIS_URL ?? DEFAULT_REDIS_URL;
    if (!(await isReachable(url))) {
      // eslint-disable-next-line no-console
      console.warn(`Skipping Redis acceptance tests: ${url} unreachable`);
      return;
    }

    client = createClient({ url });
    await client.connect();
    await client.flushDb();
    cache = new RedisCache(client);
    rateLimiter = new RedisRateLimiter(client);
  }, 30_000);

  afterAll(async () => {
    await client?.disconnect();
  });

  it('stores and retrieves values per tenant', async () => {
    if (!client) return;
    await cache.set(ctx('tenant-a'), 'draft', { body: 'hello a' });
    await cache.set(ctx('tenant-b'), 'draft', { body: 'hello b' });
    const a = await cache.get<{ body: string }>(ctx('tenant-a'), 'draft');
    const b = await cache.get<{ body: string }>(ctx('tenant-b'), 'draft');
    expect(a?.body).toBe('hello a');
    expect(b?.body).toBe('hello b');
  });

  it('honors TTL and removes expired entries', async () => {
    if (!client) return;
    await cache.set(ctx('tenant-ttl'), 'temp', { value: 1 }, 1);
    const immediate = await cache.get<{ value: number }>(ctx('tenant-ttl'), 'temp');
    expect(immediate).toEqual({ value: 1 });

    await new Promise((resolve) => setTimeout(resolve, 1200));
    const expired = await cache.get<{ value: number }>(ctx('tenant-ttl'), 'temp');
    expect(expired).toBeNull();
  });

  it('isolates idempotency keys by tenant', async () => {
    if (!client) return;
    const key = asIdempotencyKey('idem-key');
    await client.set('tenant:tenant-i1:idempotency:idem-key', '1');
    const aExists = await cache.exists(ctx('tenant-i1'), key);
    const bExists = await cache.exists(ctx('tenant-i2'), key);
    expect(aExists).toBe(true);
    expect(bExists).toBe(false);
  });

  it('deletes cache entries', async () => {
    if (!client) return;
    await cache.set(ctx('tenant-del'), 'k', 42);
    await cache.delete(ctx('tenant-del'), 'k');
    const value = await cache.get<number>(ctx('tenant-del'), 'k');
    expect(value).toBeNull();
  });

  it('rate limiter enforces per-tenant scoped limits', async () => {
    if (!client) return;
    const limit = 3;
    const results: { allowed: boolean }[] = [];
    for (let i = 0; i < limit + 1; i++) {
      results.push(await rateLimiter.isAllowed(ctx('tenant-rate'), 'send', 'alice@example.com', limit, 60));
    }
    expect(results.filter((r) => r.allowed)).toHaveLength(limit);
    expect(results[limit].allowed).toBe(false);
  });

  it('rate limiter keeps tenant scopes independent', async () => {
    if (!client) return;
    const r1 = await rateLimiter.isAllowed(ctx('tenant-rl1'), 'send', 'bob@example.com', 1, 60);
    const r2 = await rateLimiter.isAllowed(ctx('tenant-rl2'), 'send', 'bob@example.com', 1, 60);
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r1.remaining).toBe(0);
    expect(r2.remaining).toBe(0);
  });
});
