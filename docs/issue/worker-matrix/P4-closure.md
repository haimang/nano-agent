# P4 filesystem-core Absorption — Closure Memo

> 功能簇: `worker-matrix / Phase 4 — filesystem-core Absorption`
> 讨论日期: `2026-04-23`
> 作者: `GPT-5.4`
> 关联 action-plan: `docs/action-plan/worker-matrix/P4-filesystem-absorption.md`
> 文档状态: `closed(P4 absorbed runtime landed; D1+D2 moved into filesystem-core; Q4a host-local posture explicit; dry-run green)`

---

## 0. 背景

P4 的目标不是把 filesystem 远端化，而是把已经真实存在于 `workspace-context-artifacts` filesystem slice 与 `storage-topology` 中的 substrate，迁入 `workers/filesystem-core`，同时把 Q4a 的 **host-local** posture 写成代码与文档真相。

本轮完成后，`workers/filesystem-core` 已从 W4 shell 升级为 **D1 + D2 absorbed runtime**；但 `agent-core` 仍明确不启用 `FILESYSTEM_CORE` remote binding。

---

## 1. 本轮完成内容

### 1.1 吸收面

| 组 | 落地结果 |
|----|----------|
| D1 | `workers/filesystem-core/src/{types,paths,refs,artifacts,prepared-artifacts,promotion,mounts,namespace,backends}/**` + 对应 tests 已吸收 |
| D2 | `workers/filesystem-core/src/storage/**` + `workers/filesystem-core/test/storage/**` 已吸收 |
| 本地导入对齐 | backends 与 tests 已从旧 `@nano-agent/storage-topology` / 旧相对路径改为消费 worker 内本地 `src/storage/**` |
| probe truth | `workers/filesystem-core/src/index.ts` 改为 `phase: "worker-matrix-P4-absorbed"` + `absorbed_runtime: true` |

### 1.2 posture 显式化

| 文件 | 结果 |
|------|------|
| `workers/agent-core/wrangler.jsonc` | `FILESYSTEM_CORE` 继续保持注释态，并明确解释这是 first-wave host-local posture |
| `workers/agent-core/README.md` | binding 表已更新为：filesystem-core 已 absorbed，但在 agent-core 内仍 commented / host-local |
| `workers/filesystem-core/src/backends/reference.ts` | 明确记录 `connected === false` 仍是 first-wave canonical default |

---

## 2. 验证结果

| target | 结果 |
|--------|------|
| `pnpm --filter @haimang/filesystem-core-worker typecheck build test` | **24 files / 291 tests 绿** |
| `pnpm --filter @haimang/filesystem-core-worker run deploy:dry-run` | 绿 |
| `pnpm --filter @haimang/agent-core-worker typecheck build test` | **96 files / 1027 tests 绿** |
| `node --test test/*.test.mjs` | **107 绿** |
| `npm run test:cross` | **121 绿** |

---

## 3. DoD 对齐

| 项 | 状态 | 说明 |
|----|------|------|
| D1 absorbed | ✅ | filesystem slice 已进入 `workers/filesystem-core` |
| D2 absorbed | ✅ | storage-topology 已进入 `workers/filesystem-core/src/storage/**` |
| tests rebased | ✅ | storage / refs / integration tests 的路径已全部校正 |
| worker probe truth 校准 | ✅ | filesystem-core 自报已从 W4 shell 升为 P4 absorbed |
| Q4a posture 显式 | ✅ | wrangler / README / ReferenceBackend comment 三处已落盘 |
| `FILESYSTEM_CORE` 继续注释 | ✅ | first-wave 仍保持 host-local，不越位启用 remote binding |
| dry-run | ✅ | `workers/filesystem-core` deploy-shaped 验证已通过 |

---

## 4. 结论

**P4 可以正式收口。** filesystem-core 现在已经拥有 D1 + D2 的真实代码与测试面，worker 自报口径也已从 W4 shell 更新为 absorbed runtime。

同时需要明确：**P4 的完成不等于启用 `FILESYSTEM_CORE` remote service binding**。本 phase 的工程结论正好相反——代码已吸收，但 shipped runtime 仍坚持 Q4a host-local posture，等待后续 charter 再决定是否需要远端化。
