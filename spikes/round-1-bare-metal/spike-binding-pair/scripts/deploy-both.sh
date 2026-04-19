#!/usr/bin/env bash
# deploy-both.sh — enforce worker-b → worker-a deploy ordering.
#
# worker-a's wrangler.jsonc references `nano-agent-spike-binding-pair-b`
# by name in its `services` binding. If worker-b doesn't exist when
# worker-a deploys, the binding will fail at runtime (502 from
# /healthz/binding).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPIKE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "→ deploy-both.sh (强制顺序: worker-b → worker-a)"

# 1. worker-b first (callee).
echo
echo "[1/2] Deploying worker-b (callee)..."
( cd "$SPIKE_DIR/worker-b" && npx -y wrangler@4.83.0 deploy )

# 2. worker-a second (caller, with WORKER_B service binding).
echo
echo "[2/2] Deploying worker-a (caller)..."
( cd "$SPIKE_DIR/worker-a" && npx -y wrangler@4.83.0 deploy )

echo
echo "✓ Both workers deployed."
echo
echo "Sanity check:"
echo "  curl https://nano-agent-spike-binding-pair-a.haimang.workers.dev/healthz/binding"
