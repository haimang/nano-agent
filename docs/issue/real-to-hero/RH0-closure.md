# Real-to-Hero — RH0 Closure Memo

> 阶段: `real-to-hero / RH0 — Bug Fix and Prep`
> 闭合日期: `2026-04-29`
> 作者: `Owner + Opus 4.7`
> 关联 charter: `docs/charter/plan-real-to-hero.md` r2 §7.1 + §8.3
> 关联 design: `docs/design/real-to-hero/RH0-bug-fix-and-prep.md`
> 关联 action-plan: `docs/action-plan/real-to-hero/RH0-bug-fix-and-prep.md`
> 文档状态: `closed`

---

## 0. 一句话 verdict

> **RH0 正式闭合**:nano-agent 的 jwt-shared lockfile 已重建、6-worker KV/R2 binding 首次声明、≥7 份 endpoint-level *-route.test.ts ≥35 case 全绿、NanoSessionDO 拆出 verify+persistence seam 主文件 ≤1500 行 0 cycle、orchestrator-auth bootstrap-hardening 3 stress case 全绿、6 worker preview deploy 健康可达。RH1 Lane F live runtime wiring 可在已冻结的 Start Gate 上施工。

---

## 1. Phase 闭合映射

| Phase | verdict | 主要产出 |
|-------|---------|----------|
| Phase 1 — Owner Tooling Readiness (P0-F1) | ✅ closed | `docs/owner-decisions/real-to-hero-tooling.md` 8 步 checklist 全 pass |
| Phase 2 — Lockfile Rebuild (P0-A1+A2) | ✅ closed | `pnpm-lock.yaml` 重建(jwt-shared importer +5;6 stale importer 计数 0);`@haimang/jwt-shared` build/typecheck/test 全绿(20 case);root `madge` devDep + `check:cycles` script 落地 |
| Phase 3 — KV/R2 Binding Declaration (P0-C1) | ✅ closed | 6 worker `wrangler.jsonc` 首次声明 `NANO_KV` + `NANO_R2`(dev + production) |
| Phase 4 — Endpoint Test Baseline (P0-B0..B7) | ✅ closed | `workers/orchestrator-core/test/route-tests-audit.md` + 7 份 `*-route.test.ts` ≥35 case 全绿 |
| Phase 5 — Megafile Pre-Split (P0-D1+D2) | ✅ closed | `nano-session-do.ts` 2078 → **1488 行**(charter §7.1 ≤1500 hard gate);新增 `session-do-verify.ts` (367) + `session-do-persistence.ts` (370);`host/do/` 目录内 0 cycle |
| Phase 6 — Bootstrap Hardening (P0-G1) | ✅ closed | `workers/orchestrator-auth/test/bootstrap-hardening.test.ts` 3 stress case 全绿(单 case ≤30s) |
| Phase 7 — Preview Verification (P0-E1+E2) | ✅ closed | 6 worker preview deploy 健康(`/debug/workers/health` `live: 6, total: 6`);`docs/issue/zero-to-real/post-fix-verification.md` 归档 |

---

## 2. Charter §7.1 hard gate 验收

| Hard gate | 目标 | 实测 | verdict |
|-----------|------|------|---------|
| ≥7 份 `{name}-route.test.ts` | 7 | 7 | ✅ |
| ≥35 endpoint case | 35 | 35 | ✅ |
| `NanoSessionDO` ≤1500 行 | 1500 | 1488 | ✅ |
| `orchestrator-auth/test/bootstrap-hardening.test.ts` 3 case | 3 | 3 | ✅ |
| `pnpm install --frozen-lockfile` 在 fresh container 通过 | pass | pass | ✅ |
| 6 worker `wrangler deploy --dry-run` 全通 | 6 | 6 | ✅ |
| `host/do/` 0 cycle | 0 | 0 | ✅ |

---

## 3. 业主签字 / 冻结决策

- **RHX-qna Q1-Q5**:业主已在 `docs/design/real-to-hero/RHX-qna.md` 落字"同意 Opus 的推荐线路",作为 RH3/RH4/RH5/RH6 后续 phase 的冻结决策来源
- **P0-F1 8 步 checklist**:业主同日完成 1-8 步,1-6 直接 pass,7 已知 fail 升级为 in-scope(P0-A1),8 dry-run + 真实 deploy 都通

---

## 4. RH0 已知未实装(留 RH1+ 解决)

| 项 | 当前状态 | 何时 / 何 phase 落地 |
|---|---|---|
| `permission/decision` / `elicitation/answer` cross-worker push | façade routing + auth + body validation 已建立(7 份 endpoint test 验证),User-DO RPC stub 仍未 emit WS frame | RH1 Phase 2-3 (P1-C + P1-D) |
| `onUsageCommit` cross-worker push | 仍 `console.log` | RH1 Phase 4 (P1-D) |
| `/usage` strict snapshot 无 rows 返 null | 现状不变 | RH1 Phase 5 (P1-E) |
| KV / R2 binding 实质消费 | 仅占位声明 | RH4 P4-* (filesystem R2 pipeline) |
| NanoSessionDO 完整拆分 | 已 ≤1500;deferred answer/handler 仍在主文件 | RH6 megafile decomposition |
| `madge --circular` 0 cycle baseline 全仓 | 13 cycle baseline(host/do/ 0) | RH6 cleanup |

---

## 5. RH1 Per-Phase Entry Gate(charter §8.3)预核对

| 入口条件 | 状态 |
|---|---|
| RH0 design + action-plan reviewed | ✅ |
| RH0 closure 已发布 | ✅ 本文件 |
| 6 worker preview reachable + healthy | ✅ `/debug/workers/health` `live: 6` |
| jwt-shared lockfile + build pipeline 健康 | ✅ |
| endpoint baseline ≥35 case 全绿 | ✅ |
| NanoSessionDO seam pre-split | ✅ |
| RH1 design 已发布 | ✅ `docs/design/real-to-hero/RH1-lane-f-live-runtime.md` |
| RH1 action-plan 已发布 | ✅ `docs/action-plan/real-to-hero/RH1-lane-f-live-runtime.md` |

**RH1 实施可启动**。

---

## 6. 修订历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| `r1` | `2026-04-29` | `Owner + Opus 4.7` | RH0 初闭合,7 phase 全 pass + charter §7.1 hard gate 全部满足 |
