/**
 * Centralized connection configuration for the Phase 14.7c integration test
 * environment. Production runs MUST supply explicit URLs via environment
 * variables; the hard-coded fallbacks are only valid for the disposable local
 * Docker Compose integration environment.
 */

export const DEFAULT_ADMIN_DATABASE_URL =
  'postgresql://projectx:projectx@127.0.0.1:5433/projectx';
export const DEFAULT_APP_DATABASE_URL =
  'postgresql://projectx_app:projectx_app@127.0.0.1:5433/projectx';
export const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6380';
export const DEFAULT_TEMPORAL_ADDRESS = '127.0.0.1:7234';

export function getAppDatabaseUrl(): string {
  return (
    process.env.APP_DATABASE_URL ??
    process.env.DATABASE_URL ??
    DEFAULT_APP_DATABASE_URL
  );
}

export function getAdminDatabaseUrl(): string {
  return (
    process.env.ADMIN_DATABASE_URL ??
    process.env.DATABASE_URL ??
    DEFAULT_ADMIN_DATABASE_URL
  );
}

export function getRedisUrl(): string {
  return process.env.REDIS_URL ?? DEFAULT_REDIS_URL;
}

export function getTemporalAddress(): string {
  return process.env.TEMPORAL_ADDRESS ?? DEFAULT_TEMPORAL_ADDRESS;
}
