#!/usr/bin/env bash
# Install a swarm's deps once so `bun run` under a Coral session starts
# in milliseconds instead of fighting npm cold-cache during the first
# session start.
#
# Usage:
#   ./prewarm.sh                    # defaults to deepseek-swarm
#   ./prewarm.sh deepseek-swarm     # explicit
#   ./prewarm.sh minimax-swarm      # future swarms

set -euo pipefail

SWARM="${1:-deepseek-swarm}"
cd "$(dirname "$0")/$SWARM"

if [ ! -f package.json ]; then
  echo "ERROR: no package.json in $SWARM/ — is that a valid swarm name?" >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "ERROR: bun is not on PATH. Install via https://bun.sh, then re-run." >&2
  exit 1
fi

echo ">> bun install in $SWARM/"
bun install --frozen-lockfile 2>/dev/null || bun install

echo ">> typechecking $SWARM/"
bun run typecheck

echo ">> done. Start the server with:"
echo "   CONFIG_FILE_PATH=./registry.toml npx coralos-dev@latest server start"
