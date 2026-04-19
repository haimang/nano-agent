#!/usr/bin/env bash
# run-all-probes.sh — sequentially POST to all 9 probe routes and capture
# results into .out/{date}.json
#
# Usage:
#   bash scripts/run-all-probes.sh                      # default base URL
#   BASE=https://other-host bash scripts/run-all-probes.sh
#   CURL_TARGET="https://your-test-url" bash scripts/run-all-probes.sh
#
# 7 disciplines: see ../../README.md
set -euo pipefail

BASE="${BASE:-https://nano-agent-spike-do-storage.haimang.workers.dev}"
CURL_TARGET="${CURL_TARGET:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPIKE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="$SPIKE_DIR/.out"
DATE="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
OUT_FILE="$OUT_DIR/${DATE}.json"

mkdir -p "$OUT_DIR"

echo "→ run-all-probes.sh"
echo "  BASE=$BASE"
echo "  OUT=$OUT_FILE"
echo

# Smoke check.
if ! curl -sS -f "$BASE/healthz" > /dev/null; then
  echo "✗ healthz failed; aborting" >&2
  exit 1
fi
echo "✓ /healthz OK"
echo

# Probe routes in order.
declare -a ROUTES=(
  "storage-r2/multipart"
  "storage-r2/list-cursor"
  "storage-kv/stale-read"
  "storage-do/transactional"
  "storage-mem-vs-do/diff"
  "storage-d1/transaction"
  "bash/capability-parity"
  "bash/platform-stress"
  "bash/curl-quota"
)

# Per-route params (JSON). Use explicit defaults; CURL_TARGET allows
# owner override per B1 Q2.
declare -A PARAMS=(
  ["storage-r2/multipart"]='{"clean":true}'
  ["storage-r2/list-cursor"]='{"keyCount":50,"pageLimit":20,"preseed":true}'
  ["storage-kv/stale-read"]='{"delays":[0,100,500,1000]}'
  ["storage-do/transactional"]='{}'
  ["storage-mem-vs-do/diff"]='{}'
  ["storage-d1/transaction"]='{}'
  ["bash/capability-parity"]='{}'
  ["bash/platform-stress"]='{}'
  ["bash/curl-quota"]='{"counts":[10,25],"target":"'"${CURL_TARGET:-https://example.com/}"'"}'
)

# Begin combined JSON output.
{
  echo "{"
  echo "  \"capturedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"base\": \"$BASE\","
  echo "  \"results\": ["
} > "$OUT_FILE"

FIRST=1
for route in "${ROUTES[@]}"; do
  echo "→ probe: $route"
  body="${PARAMS[$route]}"
  set +e
  resp="$(curl -sS -X POST "$BASE/probe/$route" \
    -H "content-type: application/json" \
    --data "$body" \
    --max-time 60)"
  rc=$?
  set -e
  if [[ $rc -ne 0 ]]; then
    echo "  ✗ probe failed (rc=$rc)"
    resp="{\"error\":\"curl-rc-$rc\",\"validationItemId\":\"$route\"}"
  else
    echo "  ✓ probe complete"
  fi
  if [[ $FIRST -eq 0 ]]; then
    echo "    ," >> "$OUT_FILE"
  fi
  FIRST=0
  echo "    $resp" >> "$OUT_FILE"
done

{
  echo "  ]"
  echo "}"
} >> "$OUT_FILE"

echo
echo "✓ wrote $OUT_FILE"
echo
echo "Next: run scripts/extract-finding.ts to seed per-finding doc drafts."
