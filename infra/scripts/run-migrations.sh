#!/bin/sh
set -e

# Run all SQL migration files in /migrations against the bootstrapped database.
# This script is intended to be mounted into the PostgreSQL container as a
# docker-entrypoint-initdb.d hook or executed directly inside a running
# integration Postgres container.

DB="${POSTGRES_DB:-projectx}"
USER="${POSTGRES_USER:-projectx}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-/migrations}"

for migration in $(ls "${MIGRATIONS_DIR}"/*.sql | sort); do
  echo "Applying migration: ${migration}"
  psql -v ON_ERROR_STOP=1 -U "${USER}" -d "${DB}" -f "${migration}"
done

echo "Migrations applied successfully."
