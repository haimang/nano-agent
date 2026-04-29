# Real-to-Hero — RH4 Closure Memo

> 阶段: `real-to-hero / RH4 — Filesystem R2 Pipeline and Lane E`
> 闭合日期: `2026-04-29`
> 作者: `Owner + Copilot`
> 关联 charter: `docs/charter/plan-real-to-hero.md` r2 §7.5 + §8.4
> 关联 design: `docs/design/real-to-hero/RH4-filesystem-r2-pipeline-and-lane-e.md`
> 关联 action-plan: `docs/action-plan/real-to-hero/RH4-filesystem-r2-pipeline-and-lane-e.md`
> 文档状态: `close-with-known-issues`

---

## 0. 一句话 verdict

> **RH4 的 client-facing files 主链已闭合**：`010-session-files.sql` 已 apply 到 preview D1；filesystem-core 已切到真实 `R2 + D1` `SessionFileStore` 与 RPC；orchestrator-core 已提供 `POST /sessions/{id}/files` multipart upload、`GET /sessions/{id}/files` cursor list、`GET /sessions/{id}/files/{file_uuid}/content` bytes download；preview 6/6 workers 健康，RH4 的 upload/list/download smoke 与 cross-tenant deny live e2e 已通过。

> **本 Phase 仍保留 2 个 known gap**：
> 1. RH4 Phase 4 / Phase 7 的 **agent-core RPC-first consumer cutover 与 library import sunset** 还没有完成；本轮只把 `CONTEXT_CORE / FILESYSTEM_CORE` binding 与一个尚未被 consumer 读取的 `LANE_E_RPC_FIRST=false` 配置位落下，runtime consumer 仍是 host-local。
> 2. `docs/api/files-api.md`、`docs/architecture/r2-namespace.md`、`docs/owner-decisions/lane-e-sunset.md` 没有在本轮创建：前两者不是用户本轮显式指定交付物，后者还依赖 owner 冻结 prod 启用日。

---

## 1. Phase 闭合映射

| Phase | verdict | 主要产出 |
|-------|---------|----------|
| Phase 1 — Migration 010 + Namespace | ✅ closed | `nano_session_files` 表与 `session/team + created_at` 索引已入 schema；preview remote D1 已 apply |
| Phase 2 — SessionFileStore | ✅ closed | filesystem-core 新增 `SessionFileStore`；R2 bytes + D1 metadata 原子写入；rollback cleanup；cursor list |
| Phase 3 — filesystem-core RPC Surface 收口 | ✅ closed | `writeArtifact` / `listArtifacts` / `readArtifact` 真实化；`context-core` / `filesystem-core` probe 移除 `library_worker` 残留 |
| Phase 4 — agent-core binding + dual-track | ⚠️ partial | `CONTEXT_CORE` / `FILESYSTEM_CORE` binding 已启用，preview agent-core 已部署；但 RPC-first consumer 还未切换，artifact path 仍是 host-local |
| Phase 5 — Multipart Upload | ✅ closed | façade 新增 `POST /sessions/{id}/files`；25 MiB 上限；multipart parse + session ownership 校验 |
| Phase 6 — List + Download | ✅ closed | façade 新增真实 list + content download，download 返回 bytes + MIME；cross-tenant / cross-user 先做 D1 session truth gate |
| Phase 7 — Lane E Sunset Cutover | ⏸ not-started | sunset 依赖 Phase 4 真正切到 RPC-first + owner 冻结 prod 启用日 |
| Phase 8 — Validation + Preview Smoke | ✅ closed | 4 worker package tests 全绿；preview apply/deploy 成功；3 条 live/e2e 通过 |

---

## 2. RH4 hard gate 验收

| Hard gate | 目标 | 实测 | verdict |
|-----------|------|------|---------|
| migration 010 file + preview remote apply | yes | `010-session-files.sql` 已 remote apply | ✅ |
| filesystem-core package 主链 | yes | `26` files / `299` tests 全绿 | ✅ |
| context-core probe 残留清理 | yes | `19` files / `171` tests 全绿；`library_worker` 已移除 | ✅ |
| orchestrator-core `/files` 三条 façade 路由 | each ≥5 cases | `workers/orchestrator-core/test/files-route.test.ts` 新增 `15` cases，全绿 | ✅ |
| agent-core binding 激活不回归 | yes | `100` files / `1062` tests 全绿；preview binding 已可见 | ✅ |
| preview deploy 后 6 worker health | 6/6 | `/debug/workers/health` = `live: 6 / total: 6` | ✅ |
| upload/list/download live smoke | yes | package-e2e 新增 `10-files-smoke` 通过 | ✅ |
| cross-tenant deny e2e | yes | cross-e2e 新增 `14-files-cross-tenant-deny` 通过 | ✅ |
| Lane E RPC-first consumer migration | yes | binding only；consumer 仍 host-local | ⚠️ |

---

## 3. Preview 证据摘录

### 3.1 Migration + deploy

| 项 | 结果 |
|---|---|
| preview D1 migration | `010-session-files.sql` applied |
| `nano-agent-orchestrator-core-preview` | Version `342425b5-9d1c-4372-9195-aec938847104` |
| `nano-agent-filesystem-core-preview` | Version `ce5e5d26-6e8a-4e38-af0c-9236d59abfae` |
| `nano-agent-context-core-preview` | Version `3caf48da-5aa7-44cd-bf42-a98277064bed` |
| `nano-agent-agent-core-preview` | Version `411a2c9a-bd98-4cb9-bab3-2b5661603e01` |
| façade URL | `https://nano-agent-orchestrator-core-preview.haimang.workers.dev` |

### 3.2 Live smoke / E2E

| 测试文件 / 项 | 结果 |
|---|---|
| `/debug/workers/health` | `200`, `live: 6`, `total: 6` |
| `test/package-e2e/orchestrator-core/10-files-smoke.test.mjs` | ✅ upload → list → download 全链路通过 |
| `test/cross-e2e/14-files-cross-tenant-deny.test.mjs` | ✅ stranger 对 owner session 的 list/download 均 `403` |
| `test/cross-e2e/06-agent-filesystem-host-local-posture.test.mjs` | ✅ `hostLocalFilesystem=true` 且 `filesystemBindingActive=true` |

---

## 4. 已知未实装 / carry-over

| 项 | 当前状态 | 去向 |
|---|---|---|
| agent-core `workspace-context-artifacts` → filesystem RPC-first dual-track | **未切换**。根因是现有 `ArtifactStore` 为 sync metadata registry，而 RH4 的 `SessionFileStore` 是 async binary+metadata store，不能直接 drop-in 替换 | RH4 follow-up / RH5 前置修补 |
| Lane E sunset（`@deprecated` + ESLint 限制 + +14d 删除 PR） | 未开始；依赖 owner 冻结 prod 启用日 | owner + 后续执行轮次 |
| `docs/api/files-api.md` / `docs/architecture/r2-namespace.md` | 本轮未创建 | 文档轮次 |
| `docs/owner-decisions/lane-e-sunset.md` | 未创建；需要 owner 填入 prod 启用日 / 到期日 | owner |

---

## 5. RH5 Per-Phase Entry Gate 预核对

| 入口条件 | 状态 |
|---|---|
| RH4 migration / preview apply 已完成 | ✅ |
| client-facing upload/list/download 真实可用 | ✅ |
| cross-tenant files deny 已验证 | ✅ |
| preview 6-worker health 仍为 6/6 | ✅ |
| Lane E consumer sunset 已完成 | ❌ |

**结论**：若 RH5 只要求“客户端已有真实 files surface，可承接 image/file input”，则 **可以进入 RH5**；若 RH5 先决条件被收紧为“agent-core 已彻底切到 filesystem/context RPC-first 且 sunset 已启动”，则仍需先清理 §4 的 carry-over。

---

## 6. Opus 审核后校正

- 已同步修正文档事实：
  1. RH4 action-plan 中 migration 010 的 `created_at` 已从错误的 `INTEGER` 回填为实际实现的 `TEXT (ISO 8601)`。
  2. RH3/RH4 action-plan 中 e2e 文件名已改回仓库真实存在的 numbered `.mjs` 路径。
  3. Lane E 仍维持 binding-only 现状：`LANE_E_RPC_FIRST` 目前只是配置位，不代表 dual-track consumer 已落地，因此本 closure 继续保持 `close-with-known-issues`。

---

## 7. 修订历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| `r1` | `2026-04-29` | `Owner + Copilot` | RH4 首轮 closure：记录 migration 010 apply、filesystem/orchestrator files 主链、preview deploy、unit/live 验证，并显式保留 Lane E consumer / sunset carry-over |
| `r2` | `2026-04-29` | `Copilot` | 根据 Opus 审核校正 RH4 文档事实：migration 字段类型、e2e 路径命名与 Lane E binding-only 口径 |
