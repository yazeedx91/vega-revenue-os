#!/bin/sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$(cd "$SCRIPT_DIR/.." && pwd)/docker-compose.integration.yml"

echo "Starting integration environment from $COMPOSE_FILE ..."
docker compose -f "$COMPOSE_FILE" up -d

echo "Waiting for services to become healthy ..."
"$SCRIPT_DIR/integration-wait.sh"

echo "Integration environment is up."
