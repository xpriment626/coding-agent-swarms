#!/usr/bin/env bash
# Exports the shared Daytona sandbox workspace to a local directory.
# Walks /workspace, downloads each file via the Toolbox bulk-download
# endpoint, unpacks the multipart response into $OUTPUT_DIR.
#
# Usage:
#   ./orchestration/export-sandbox.sh <sandbox-id> [<output-dir>]
#
# Default output dir: /Users/bambozlor/Desktop/sandbox-out/<timestamp>

set -euo pipefail

SANDBOX_ID="${1:?usage: export-sandbox.sh <sandbox-id> [output-dir]}"
OUTPUT_DIR="${2:-/Users/bambozlor/Desktop/sandbox-out/$(date +%Y%m%d-%H%M%S)}"

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "ERROR: no .env file. Fill DAYTONA_API_KEY first." >&2
  exit 1
fi

# shellcheck disable=SC2046
export $(grep -v '^#' .env | xargs)

: "${DAYTONA_API_KEY:?missing DAYTONA_API_KEY in .env}"

mkdir -p "$OUTPUT_DIR"

BASE_URL="https://proxy.app.daytona.io/toolbox/$SANDBOX_ID"
# Daytona toolbox auth flipped: standard Authorization works on every endpoint;
# X-Daytona-Authorization now 401s. See foundation memory for the full story.
AUTH="Authorization: Bearer $DAYTONA_API_KEY"

echo ">> listing /workspace in sandbox $SANDBOX_ID"
listing=$(curl -sS -H "$AUTH" "$BASE_URL/files?path=/workspace")

# Extract file paths recursively. The Toolbox /files endpoint returns
# entries for a single directory; we use `find`-style recursion via exec.
echo ">> enumerating files (recursive)"
file_paths=$(curl -sS -H "$AUTH" -H "Content-Type: application/json" \
  -X POST "$BASE_URL/process/execute" \
  --data '{"command":"find /workspace -type f -not -path \"*/\\.git/*\"","timeout":30}' \
  | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('result') or d.get('stdout') or '')")

if [ -z "$file_paths" ]; then
  echo "WARN: no files found under /workspace in sandbox $SANDBOX_ID" >&2
  exit 0
fi

# Build the bulk-download JSON payload. Use python for robust quoting.
payload=$(echo "$file_paths" | python3 -c "
import sys, json
paths = [p.strip() for p in sys.stdin.read().splitlines() if p.strip()]
print(json.dumps({'paths': paths}))
")

echo ">> bulk-downloading $(echo "$file_paths" | wc -l | tr -d ' ') files to $OUTPUT_DIR"

# Dump multipart body to a temp file, then let python's email parser
# split it into individual files under OUTPUT_DIR.
tmp_response=$(mktemp)
trap 'rm -f "$tmp_response"' EXIT

curl -sS -H "$AUTH" -H "Content-Type: application/json" \
  -X POST "$BASE_URL/files/bulk-download" \
  --data "$payload" \
  -o "$tmp_response"

python3 - "$tmp_response" "$OUTPUT_DIR" <<'PY'
import sys, email, os, pathlib

body_file, out_dir = sys.argv[1], sys.argv[2]
with open(body_file, 'rb') as f:
    raw = f.read()

# The response is multipart; prepend a minimal header so email.message_from_bytes parses cleanly.
# Look up boundary from the first line.
first_nl = raw.find(b'\r\n')
if first_nl == -1:
    first_nl = raw.find(b'\n')
first_line = raw[:first_nl].decode('latin-1')
if not first_line.startswith('--'):
    print(f"ERROR: unexpected response start: {first_line!r}", file=sys.stderr)
    sys.exit(1)
boundary = first_line[2:].strip()
header = f"Content-Type: multipart/form-data; boundary={boundary}\r\n\r\n".encode('latin-1')
msg = email.message_from_bytes(header + raw)

saved = 0
for part in msg.walk():
    if part.is_multipart():
        continue
    content_disp = part.get('Content-Disposition', '')
    # Expect name="file" or name="error"; filename=... points to sandbox path
    if 'filename' not in content_disp:
        continue
    # Extract filename. Format: Content-Disposition: form-data; name="file"; filename="/workspace/src/main.py"
    import re
    m = re.search(r'filename="([^"]+)"', content_disp)
    if not m:
        continue
    sandbox_path = m.group(1)
    # Strip leading /workspace/ to get a relative path under OUTPUT_DIR
    rel = sandbox_path.lstrip('/')
    if rel.startswith('workspace/'):
        rel = rel[len('workspace/'):]
    dest = pathlib.Path(out_dir) / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    payload = part.get_payload(decode=True)
    if payload is None:
        continue
    dest.write_bytes(payload)
    saved += 1

print(f"wrote {saved} files to {out_dir}")
PY

echo ">> done"
echo ">> output: $OUTPUT_DIR"
