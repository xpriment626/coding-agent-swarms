#!/usr/bin/env bash
# Coral spawns this from the team-swarm/agent/ directory. Bun runs TS natively.
set -euo pipefail
cd "$(dirname "$0")"
exec bun ../shared/run-agent.ts
