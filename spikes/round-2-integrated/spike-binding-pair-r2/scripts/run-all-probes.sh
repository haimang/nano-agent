#!/usr/bin/env bash
# Drive every round-2 binding-pair probe against a deployed worker-a-r2
# URL and write the raw JSON results to .out/.
#
# Usage:
#   WORKER_A_URL=https://nano-agent-spike-binding-pair-a-r2.<subdomain>.workers.dev \
#     scripts/run-all-probes.sh
#
# For binding-F01 you should ALSO capture the callee-side log by
# running `wrangler tail` against `nano-agent-spike-binding-pair-b-r2`
# in a separate terminal and piping to `.out/binding-f01.tail.log`.

set -euo pipefail

if [[ -z "${WORKER_A_URL:-}" ]]; then
  echo "ERROR: WORKER_A_URL is required" >&2
  exit 2
fi

OUT_DIR=".out"
mkdir -p "$OUT_DIR"

ROUTES=(
  "probe/follow-ups/binding-f01-callee-abort"
  "probe/follow-ups/binding-f04-true-callback"
  "probe/re-validation/binding"
)

FAIL=0
for route in "${ROUTES[@]}"; do
  filename=".out/$(echo "$route" | tr '/' '_').json"
  echo "POST $WORKER_A_URL/$route -> $filename"
  http_code=$(curl -sS -o "$filename" -w "%{http_code}" -X POST \
    -H 'content-type: application/json' --data '{}' \
    "$WORKER_A_URL/$route" || true)
  if [[ "$http_code" != "200" ]]; then
    echo "  WARN: HTTP $http_code for $route" >&2
    FAIL=1
  fi
done

if [[ $FAIL -ne 0 ]]; then
  echo "one or more probes returned non-2xx; see $OUT_DIR/*.json" >&2
  exit 1
fi

echo "all binding-pair-r2 probes completed; results in $OUT_DIR/"
echo "REMINDER: capture callee-side abort log separately:"
echo "  (cd worker-b-r2 && pnpm exec wrangler tail) > .out/binding-f01.tail.log"
