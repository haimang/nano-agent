#!/bin/bash
# Lint: ensure no direct R2/KV/DO storage access outside scoped-io.ts
# GPT code-review §2.7: S10 enforcement via grep since biome cannot lint property access.

set -euo pipefail

VIOLATIONS=$(grep -rn 'env\.R2_\|env\.KV_\|\.storage\.put\|\.storage\.get\|\.storage\.delete' src/ \
  --include='*.ts' \
  | grep -v 'scoped-io.ts' \
  | grep -v '// tenant-io-ok' \
  || true)

if [ -n "$VIOLATIONS" ]; then
  echo "❌ TENANT IO VIOLATION: Direct storage access found outside scoped-io.ts"
  echo ""
  echo "$VIOLATIONS"
  echo ""
  echo "Fix: Use tenantR2Put/Get/etc. from tenancy/scoped-io.ts instead."
  echo "If this is intentional, add '// tenant-io-ok' comment to the line."
  exit 1
fi

echo "✅ No direct storage access violations found."
