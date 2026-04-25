#!/usr/bin/env bash
# Coral launches this from the planner/ directory. Bun runs TS natively
# so there's no build step — just invoke the entry directly.
set -euo pipefail
cd "$(dirname "$0")"
exec bun run src/main.ts
