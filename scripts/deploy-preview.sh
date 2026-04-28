#!/usr/bin/env bash
# ZX5 Lane D D1 — owner-local preview deploy with WORKER_VERSION env-fill.
#
# Per ZX5 Q2 owner answer: deploy pipeline 走 owner local `wrangler deploy
# --env preview`,不再维护 GitHub Actions 路径。本脚本统一在 6 worker deploy
# 之前 export WORKER_VERSION,把每 worker 的 build 与 git sha 绑定起来,替代
# ZX2 时期的硬编码 `worker-name@preview`。
#
# Usage:
#   bash scripts/deploy-preview.sh                  # all 6 workers
#   bash scripts/deploy-preview.sh agent-core       # single worker
#   GIT_SHA=manual-tag bash scripts/deploy-preview.sh
#   WORKER_VERSION_SUFFIX=hotfix bash scripts/deploy-preview.sh
#
# Side effects:
#   - 在 wrangler.jsonc 之外通过 `--var WORKER_VERSION:<version>` 注入
#     `WORKER_VERSION` env var(优先于 wrangler.jsonc 的 vars block)
#   - per-worker version 形式: `${WORKER_NAME}@${GIT_SHA}[+${SUFFIX}]`
#
# Ops gate hooks(per ZX4 closure §3.3 + runbook §2.4 prod hard gate):
#   - prod deploy 时本脚本应被改写成调用 `wrangler d1 migrations apply
#     --env prod --remote` 之前。
#   - **preview**:本脚本以 best-effort 自动跑 `wrangler d1 migrations apply
#     --env preview` (per ZX5 review GLM R3) — D6 新增的 migration
#     007-user-devices.sql 必须先 apply,否则 /me/devices*  endpoint 会
#     500;migration apply 是幂等的,已 apply 过会被 wrangler 跳过。
#     设 SKIP_D1_MIGRATIONS=1 可跳过(用于本地仅 worker 重 deploy)。
#
# Exit codes:
#   0 — all deploys succeeded
#   1 — any deploy failed(脚本立即退出,不继续后续 worker)
#   2 — git not available / not a repo

set -euo pipefail

# ── §1 — config ───────────────────────────────────────────────────────

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKERS_DIR="${REPO_ROOT}/workers"

# Default 6-worker deploy order: leaf → agent-core → orchestrator-core
# (orchestrator-core depends on agent-core RPC binding;agent-core depends
#  on bash-core capability binding;leaf 3 个互不依赖)。
DEFAULT_WORKERS=(
  bash-core
  filesystem-core
  context-core
  orchestrator-auth
  agent-core
  orchestrator-core
)

# ── §2 — git sha resolution ──────────────────────────────────────────

resolve_git_sha() {
  if [[ -n "${GIT_SHA:-}" ]]; then
    printf '%s' "${GIT_SHA}"
    return 0
  fi
  if ! command -v git >/dev/null 2>&1; then
    echo "deploy-preview.sh: git not found and GIT_SHA not set" >&2
    exit 2
  fi
  if ! git -C "${REPO_ROOT}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "deploy-preview.sh: not in a git repo and GIT_SHA not set" >&2
    exit 2
  fi
  local sha
  sha="$(git -C "${REPO_ROOT}" rev-parse --short HEAD)"
  if git -C "${REPO_ROOT}" diff --quiet HEAD -- 2>/dev/null; then
    printf '%s' "${sha}"
  else
    printf '%s-dirty' "${sha}"
  fi
}

# ── §3 — single-worker deploy ────────────────────────────────────────

deploy_worker() {
  local worker_name="$1"
  local git_sha="$2"
  local suffix="${3:-}"
  local version="${worker_name}@${git_sha}"
  if [[ -n "${suffix}" ]]; then
    version="${version}+${suffix}"
  fi
  local worker_dir="${WORKERS_DIR}/${worker_name}"
  if [[ ! -d "${worker_dir}" ]]; then
    echo "deploy-preview.sh: worker dir not found: ${worker_dir}" >&2
    exit 1
  fi
  echo "▸ Deploying ${worker_name} as WORKER_VERSION=${version}"
  (
    cd "${worker_dir}"
    npx wrangler deploy --env preview --var "WORKER_VERSION:${version}"
  )
}

# ── §4 — entrypoint ──────────────────────────────────────────────────

# ── §4 — D1 migrations apply (preview) ───────────────────────────────
#
# Per ZX5 review GLM R3:每次 preview deploy 之前自动 apply pending D1
# migrations。orchestrator-core/migrations/ 下当前包含 005-006 (ZX4) 与
# 007-user-devices.sql (ZX5 D6),wrangler 会跳过已 apply 过的版本。
apply_d1_migrations_preview() {
  if [[ "${SKIP_D1_MIGRATIONS:-0}" == "1" ]]; then
    echo "▸ SKIP_D1_MIGRATIONS=1 — skipping wrangler d1 migrations apply"
    return 0
  fi
  if [[ ! -d "${WORKERS_DIR}/orchestrator-core" ]]; then
    echo "deploy-preview.sh: orchestrator-core dir missing,跳过 migration apply" >&2
    return 0
  fi
  echo "▸ Applying D1 migrations to preview (NANO_AGENT_DB)"
  (
    cd "${WORKERS_DIR}/orchestrator-core"
    npx wrangler d1 migrations apply NANO_AGENT_DB --env preview --remote
  )
}

# ── §5 — entrypoint ──────────────────────────────────────────────────

main() {
  local git_sha
  git_sha="$(resolve_git_sha)"
  local suffix="${WORKER_VERSION_SUFFIX:-}"

  local targets=()
  if [[ $# -gt 0 ]]; then
    targets=("$@")
  else
    targets=("${DEFAULT_WORKERS[@]}")
  fi

  echo "═════════════════════════════════════════════════════════════════"
  echo "ZX5 Lane D D1 — preview deploy"
  echo "  GIT_SHA: ${git_sha}"
  if [[ -n "${suffix}" ]]; then
    echo "  WORKER_VERSION_SUFFIX: ${suffix}"
  fi
  echo "  WORKERS: ${targets[*]}"
  echo "═════════════════════════════════════════════════════════════════"

  apply_d1_migrations_preview

  for worker in "${targets[@]}"; do
    deploy_worker "${worker}" "${git_sha}" "${suffix}"
  done

  echo
  echo "✅ All deploys succeeded(${#targets[@]} workers)"
}

main "$@"
