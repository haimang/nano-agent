#!/usr/bin/env bash
# Deploy worker-b-r2 first (so worker-a-r2's services binding resolves),
# then worker-a-r2. Mirrors the Round-1 order.
#
# Usage: scripts/deploy-both.sh

set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> deploying worker-b-r2 (callee)"
(cd worker-b-r2 && pnpm exec wrangler deploy)

echo "==> deploying worker-a-r2 (caller)"
(cd worker-a-r2 && pnpm exec wrangler deploy)

echo "done."
