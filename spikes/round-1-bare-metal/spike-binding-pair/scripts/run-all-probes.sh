#!/usr/bin/env bash
# run-all-probes.sh — sequentially POST to all 4 V3 probe routes on
# worker-a and capture results into .out/{date}.json
#
# Usage:
#   bash scripts/run-all-probes.sh
#   BASE=https://other-host bash scripts/run-all-probes.sh
#
# 7 disciplines: see ../../README.md
set -euo pipefail

BASE="${BASE:-https://nano-agent-spike-binding-pair-a.haimang.workers.dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPIKE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="$SPIKE_DIR/.out"
DATE="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
OUT_FILE="$OUT_DIR/${DATE}.json"

mkdir -p "$OUT_DIR"

echo "→ run-all-probes.sh (binding-pair)"
echo "  BASE=$BASE"
echo "  OUT=$OUT_FILE"
echo

# Smoke: worker-a healthz + cross-binding sanity.
if ! curl -sS -f "$BASE/healthz" > /dev/null; then
  echo "✗ worker-a /healthz failed; aborting" >&2
  exit 1
fi
echo "✓ worker-a /healthz OK"

if ! curl -sS -f "$BASE/healthz/binding" > /dev/null; then
  echo "✗ worker-a /healthz/binding failed (worker-b unreachable via service binding); aborting" >&2
  exit 1
fi
echo "✓ worker-a /healthz/binding OK (binding to worker-b live)"
echo

declare -a ROUTES=(
  "binding-latency-cancellation"
  "binding-cross-seam-anchor"
  "binding-hooks-callback"
  "binding-eval-fanin"
)

declare -A PARAMS=(
  ["binding-latency-cancellation"]='{"baselineSamples":20,"concurrentN":10,"cancelDelayMs":300}'
  ["binding-cross-seam-anchor"]='{}'
  ["binding-hooks-callback"]='{}'
  ["binding-eval-fanin"]='{}'
)

{
  echo "{"
  echo "  \"capturedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"base\": \"$BASE\","
  echo "  \"transportScope\": \"fetch-based-seam (handleNacp RPC NOT covered)\","
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
    --max-time 90)"
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
