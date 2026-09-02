#!/bin/sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$(cd "$SCRIPT_DIR/.." && pwd)/docker-compose.integration.yml"

echo "Stopping integration environment ..."
docker compose -f "$COMPOSE_FILE" down

echo "Integration environment is down."
