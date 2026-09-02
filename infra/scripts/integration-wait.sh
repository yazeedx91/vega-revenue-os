#!/bin/sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$(cd "$SCRIPT_DIR/.." && pwd)/docker-compose.integration.yml"

wait_for() {
  name="$1"
  cmd="$2"
  timeout="${3:-60}"
  interval="${4:-2}"
  elapsed=0
  while [ "$elapsed" -lt "$timeout" ]; do
    if eval "$cmd" >/dev/null 2>&1; then
      echo "  $name is ready."
      return
    fi
    echo "  Waiting for $name ..."
    sleep "$interval"
    elapsed=$((elapsed + interval))
  done
  echo "Timed out waiting for $name after ${timeout}s." >&2
  exit 1
}

wait_for 'PostgreSQL' 'docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U projectx -d projectx' 60 2
wait_for 'Redis' 'docker compose -f "$COMPOSE_FILE" exec -T redis redis-cli ping | grep -q PONG' 60 2
wait_for 'Temporal frontend' 'docker compose -f "$COMPOSE_FILE" exec -T temporal sh -c "nc -z localhost 7233"' 120 2

echo "All integration services are ready."
