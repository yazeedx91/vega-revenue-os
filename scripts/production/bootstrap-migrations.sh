#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

if [[ "${PRODUCTION_MIGRATION_TARGET_APPROVED:-}" != "true" ]]; then
  echo "PRODUCTION_MIGRATION_TARGET_APPROVED must be 'true'" >&2
  exit 1
fi

# Refuse obviously local targets.
if [[ "$DATABASE_URL" =~ (^|@|//)localhost[:/] || "$DATABASE_URL" =~ 127\.0\.0\.1 ]]; then
  echo "Refusing to migrate against a local target: $DATABASE_URL" >&2
  exit 1
fi

if [[ "$DATABASE_URL" =~ :projectx@localhost:5433/ ]]; then
  echo "Refusing to migrate against the local integration PostgreSQL" >&2
  exit 1
fi

echo "Target host: $(echo "$DATABASE_URL" | sed -n 's/.*@\([^:/?]*\).*/\1/p')"

cd "$(dirname "$0")/../.."

pnpm install --frozen-lockfile
pnpm -r build

export NODE_ENV=production
pnpm exec tsx infra/database/migrations/run.ts

echo "Migrations complete. Verifying schema_migrations..."

psql "$DATABASE_URL" -c "SELECT filename, applied_at FROM schema_migrations ORDER BY filename;" >&2
