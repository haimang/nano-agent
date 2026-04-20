#!/usr/bin/env bash
# Drive every round-2 storage/bash/context probe against a deployed
# worker URL and write the raw JSON results to .out/.
#
# Usage:
#   WORKER_URL=https://nano-agent-spike-do-storage-r2.<subdomain>.workers.dev \
#     scripts/run-all-probes.sh
#
# Environment:
#   WORKER_URL          — required; the deployed round-2 worker
#   F09_OWNER_URL       — optional; when set, the gated curl-high-volume probe runs
#   F03_CROSS_COLO      — optional; when "true", the gated KV cross-colo probe runs
#
# Every probe's JSON is written to .out/<route>.json. The script exits
# non-zero if any probe itself returned a non-2xx HTTP status.

set -euo pipefail

if [[ -z "${WORKER_URL:-}" ]]; then
  echo "ERROR: WORKER_URL is required" >&2
  exit 2
fi

OUT_DIR=".out"
mkdir -p "$OUT_DIR"

ROUTES=(
  "probe/follow-ups/do-size-cap-binary-search"
  "probe/follow-ups/r2-concurrent-put"
  "probe/follow-ups/kv-cross-colo-stale"
  "probe/follow-ups/curl-high-volume"
  "probe/re-validation/storage"
  "probe/re-validation/bash"
  "probe/re-validation/context"
)

FAIL=0
for route in "${ROUTES[@]}"; do
  filename=".out/$(echo "$route" | tr '/' '_').json"
  echo "POST $WORKER_URL/$route -> $filename"
  http_code=$(curl -sS -o "$filename" -w "%{http_code}" -X POST \
    -H 'content-type: application/json' --data '{}' \
    "$WORKER_URL/$route" || true)
  if [[ "$http_code" != "200" ]]; then
    echo "  WARN: HTTP $http_code for $route" >&2
    FAIL=1
  fi
done

if [[ $FAIL -ne 0 ]]; then
  echo "one or more probes returned non-2xx; see $OUT_DIR/*.json" >&2
  exit 1
fi

echo "all probes completed; results in $OUT_DIR/"
