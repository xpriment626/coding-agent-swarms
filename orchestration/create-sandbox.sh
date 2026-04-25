#!/usr/bin/env bash
# Creates a new Daytona sandbox and prints the ID on stdout. Capture it
# into an env var or paste it into orchestration/create-session.http.
#
# Usage:
#   ./orchestration/create-sandbox.sh                    # default 2vCPU/4GiB/8GiB sandbox
#   ./orchestration/create-sandbox.sh > /tmp/sandbox-id  # capture the id
#
# Endpoint: https://app.daytona.io/api/sandbox
# Docs: https://www.daytona.io/docs/en/sandboxes

set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "ERROR: no .env file found. Copy .env.example and fill DAYTONA_API_KEY." >&2
  exit 1
fi

# shellcheck disable=SC2046
export $(grep -v '^#' .env | xargs)

: "${DAYTONA_API_KEY:?missing DAYTONA_API_KEY in .env}"

# Daytona rejects sending cpu/memory/disk alongside a default snapshot; pass
# an empty body to accept snapshot defaults. If you need custom sizing, omit
# the snapshot instead (see https://www.daytona.io/docs/en/sandboxes).
response=$(curl -sS -X POST https://app.daytona.io/api/sandbox \
  -H "Authorization: Bearer $DAYTONA_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{}')

# Extract the id field. Daytona returns JSON like {"id": "...", ...}.
sandbox_id=$(printf '%s' "$response" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('id', ''))")

if [ -z "$sandbox_id" ]; then
  echo "ERROR: could not extract sandbox id from Daytona response:" >&2
  echo "$response" >&2
  exit 1
fi

# Daytona sandboxes ship with /home/daytona but no /workspace. Every agent
# in this megarepo writes into /workspace by convention, so initialize it
# here once instead of relying on the agent's first daytona_exec to do so
# (some models drift toward home dirs when /workspace is missing).
init_status=$(curl -sS -X POST "https://proxy.app.daytona.io/toolbox/$sandbox_id/process/execute" \
  -H "Authorization: Bearer $DAYTONA_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{"command":"sudo mkdir -p /workspace && sudo chown daytona:daytona /workspace && ls -ld /workspace","timeout":15}' \
  -o /dev/null -w "%{http_code}")
if [ "$init_status" != "200" ]; then
  echo "WARN: /workspace init returned HTTP $init_status — agents may need to mkdir manually" >&2
fi

echo "$sandbox_id"
