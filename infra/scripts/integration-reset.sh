#!/bin/sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Stopping integration environment and removing volumes ..."
"$SCRIPT_DIR/integration-down.sh" -v

echo "Restarting integration environment ..."
"$SCRIPT_DIR/integration-up.sh"

echo "Integration environment has been reset."
