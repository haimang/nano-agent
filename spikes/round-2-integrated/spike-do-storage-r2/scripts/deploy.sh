#!/usr/bin/env bash
# Deploy spike-do-storage-r2 with owner's wrangler credentials.
#
# Before running, populate:
#   - wrangler.jsonc: KV namespace id, D1 database id (see placeholders)
#   - F09_OWNER_URL   (optional; empty = gated skip for curl-high-volume)
#   - F03_CROSS_COLO_ENABLED (optional; "true" to run KV cross-colo)

set -euo pipefail
cd "$(dirname "$0")/.."
pnpm exec wrangler deploy
