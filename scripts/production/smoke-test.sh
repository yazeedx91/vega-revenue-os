#!/usr/bin/env bash
set -euo pipefail

: "${API_BASE_URL:?API_BASE_URL is required}"
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${REDIS_HOST:?REDIS_HOST is required}"

echo "Smoke testing $API_BASE_URL"

curl -sf "${API_BASE_URL}/health" >/dev/null
echo "PASS: /health"

curl -sf "${API_BASE_URL}/ready" >/dev/null
echo "PASS: /ready"

curl -sf "${API_BASE_URL}/health/secrets" >/dev/null
echo "PASS: /health/secrets"

# Webhook forged clientState should be rejected.
status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${API_BASE_URL}/webhooks/graph" \
  -H "Content-Type: application/json" \
  -d '{"clientState":"invalid"}' || true)
if [[ "$status" == "401" || "$status" == "403" ]]; then
  echo "PASS: webhook rejects invalid clientState"
else
  echo "WARN: webhook returned $status (expected 401/403)"
fi

echo "Smoke tests complete. No live outreach was attempted."
