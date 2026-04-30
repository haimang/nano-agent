# HP8 Runtime Hardening + Chronic Closure — Closure

> 服务业务簇: `hero-to-pro / HP8`
> 上游 action-plan: `docs/action-plan/hero-to-pro/HP8-action-plan.md`
> 上游 design: `docs/design/hero-to-pro/HP8-runtime-hardening-and-chronic-closure.md`
> 冻结决策来源: `docs/design/hero-to-pro/HPX-qna.md` Q25 / Q26 / Q27 / Q28
> 闭环日期: `2026-04-30`
> 文档状态: `partial`

---

## 0. 总体 Verdict

| 维度 | 结论 |
|------|------|
| HP8 当前状态 | `partial-live`(megafile / tool-drift / envelope-drift 三类 root gate live;tool catalog SSoT live;Lane E final-state 文档冻结;heartbeat 4-scenario e2e、R28/R29 explicit register、HP9 freeze gate verdict 仍未收口) |
| Phase 1 chronic register | `partial`(Lane E `retained-with-reason` 终态已写;R28 / R29 register 留给 HP8 后续批次) |
| Phase 2 heartbeat posture + 4-scenario e2e | `not-yet`(`alarm()` 主线已存在,但 phase-level posture 验证矩阵未运行) |
| Phase 3 stop-the-bleed gates | `done-first-wave`(megafile budget gate / tool drift guard / envelope drift guard 三件套 live + 接入 root `package.json`) |
| Phase 4 tool catalog + envelope cleanup + Lane E | `done-first-wave-on-3`(tool catalog SSoT + Lane E final-state 已 live;public envelope 通过 `check:envelope-drift` 已 clean;consumer migration 留给 HP8 后续批次) |
| Phase 5 HP9 freeze gate | `gated`(本 closure 未授予 HP9 启动许可,见 §5 verdict) |
| chronic terminal compliance (Q28) | `partial`(Lane E 显式 `retained-with-reason`;R28 / R29 仍未给出 `closed / retained-with-reason / handed-to-platform`) |
| 测试矩阵 | `partial-green`(`@haimang/nacp-core` 344/344、`@haimang/nacp-session` 196/196、`@haimang/orchestrator-core-worker` 305/305、`@haimang/agent-core-worker` 1077/1077;cross-e2e 4-scenario 未运行) |

---

## 1. Resolved 项(本轮 HP8 已落地、可直接消费)

| ID | 描述 | 证据 | 说明 |
|----|------|------|------|
| `R1` | 三类 root gate 接入 `package.json`:`check:megafile-budget` / `check:tool-drift` / `check:envelope-drift` | `package.json` | repo 漂移第一次有硬闸 |
| `R2` | `scripts/megafile-budget.json` 与 `scripts/check-megafile-budget.mjs`,Q25 stop-the-bleed ceilings;只盯当前 owner 文件,wrapper / generated 不计 | 本轮 5 个 owner 文件全部 within budget | 大文件治理脱离历史名称 |
| `R3` | `scripts/check-tool-drift.mjs`:基于 `nacp-core` tool catalog SSoT 检测重复 / 未注册 tool literal | smoke 跑通 | tool contract 漂移变成 CI fail |
| `R4` | `scripts/check-envelope-drift.mjs`:public-only scope,balance-paren scan + `data | error` 判别;允许 health-aggregate 例外 | smoke 跑通 | Q27 public-only 边界硬化 |
| `R5` | `packages/nacp-core/src/tools/tool-catalog.ts`(SSoT)+ `findToolEntry` / `TOOL_CATALOG_IDS` + `Object.freeze` | nacp-core test 7/7 | Q26 catalog 落 nacp-core;不允许 worker 层重建 |
| `R6` | nacp-core public surface 新增 `TOOL_CATALOG / TOOL_CATALOG_IDS / findToolEntry / ToolCatalogEntry / ToolCapabilityOwner` re-export | `packages/nacp-core/src/index.ts` | 下游 worker 直接消费 SSoT,无需各自镜像 |
| `R7` | `docs/architecture/lane-e-final-state.md` 冻结终态 = `retained-with-reason`,Q28 4 项必填字段(scope / risk / remove condition / owner)齐全 | 文档 | Lane E 不再使用 "shim" 口径 |
| `R8` | observability inspector 12-kind drift fix(HP6 + HP7 已落)与 HP8 root gate 形成多层 drift 守卫 | `workers/agent-core/src/eval/inspector.ts` | F13 carryover 进一步收紧 |

---

## 2. Partial 项(HP8 已开工,但本轮未完成的 action-plan 条目)

| ID | 描述 | 当前完成度 | 后续 phase / 批次 | 说明 |
|----|------|-----------|-------------------|------|
| `P1` | R28 explicit register:stack source / root cause class / chosen branch 三字段回填 | `not-started` | HP8 后续批次(owner-action 强依赖) | runbook `zx5-r28-investigation.md` 仍是模板 |
| `P2` | R29 verifier `scripts/verify-initial-context-divergence.mjs` + `R29-postmortem.md` 三选一判定 | `not-started` | HP8 后续批次 | 与 R28 同批次 owner-action |
| `P3` | heartbeat posture hardening:`alarm()` 主线 + `persistCheckpoint` / `sweepDeferredAnswers` / helper restore 顺序冻结 | `not-touched` | HP8 后续批次 | runtime seam 已存在,缺 phase-level posture lock + 4-scenario e2e |
| `P4` | abnormal disconnect 4-scenario cross-e2e | `not-run` | HP8 后续批次 | 与 P3 同批次 |
| `P5` | tool catalog consumer migration:agent-core / bash-core 改为消费 catalog,而不是保留本地镜像 | `not-wired` | HP8 后续批次 | catalog 已 live,drift guard 在等 consumer 真正向其收敛 |
| `P6` | public envelope cleanup consumer 侧:对外 `Response.json` 依然散布在 façade router 30+ 处,等 HP8 后续批次集中走 helper | `not-wired` | HP8 后续批次 | drift guard 已 clean,但仍依赖 helper-by-helper 写法,集中化后可移除例外 |
| `P7` | HP9 freeze gate verdict 真正 grant | `not-granted` | HP8 后续批次 closure(R28 / R29 / heartbeat 4-scenario 落地后) | 见 §5 |

---

## 3. Retained 项(本轮显式保留 / 不改)

| ID | 描述 | 来源 frozen 法律 | 后续去向 |
|----|------|-----------------|----------|
| `K1` | megafile gate 不盯历史文件名(`nano-session-do.ts` / `user-do.ts` 这类 wrapper) | Q25 | 后续 split 后只下调阈值,不上调 |
| `K2` | tool catalog 唯一住址在 `packages/nacp-core/src/tools/tool-catalog.ts`;agent-core / bash-core 不允许新建第二个 registry | Q26 | drift guard 守门 |
| `K3` | internal `Envelope<T>` / `AuthEnvelope<T>` 保留;envelope cleanup 仅针对 public HTTP surface | Q27 | 后续不重评 |
| `K4` | chronic 项允许 `retained-with-reason` / `handed-to-platform`,但必须显式 4 字段 | Q28 | R28/R29 后续批次必须遵守 Lane E 文档同款字段 |
| `K5` | Lane E `host-local workspace-runtime` 终态 = `retained-with-reason`;remove 条件挂在 filesystem-core leaf RPC 完整接线 | `lane-e-final-state.md` §3 | HP6 / HP7 后续批次满足 §3 任意条件后,可降为 `closed` |

---

## 4. F1-F17 chronic status 登记(强制)

| chronic | 说明 | HP8 verdict | 备注 |
|---------|------|-------------|------|
| F1 | 公共入口模型字段透传断裂 | `closed-by-HP0` | 本轮未触碰 |
| F2 | system prompt model-aware suffix 缺失 | `closed-by-review-fix` | 本轮未触碰 |
| F3 | session-level current model 与 alias resolution | `closed-by-HP2-first-wave` | 本轮未触碰 |
| F4 | context state machine | `carried-from-HP3-partial` | 本轮未扩写 |
| F5 | chat lifecycle | `carried-from-HP4-partial` | 本轮未扩写 |
| F6 | confirmation control plane | `carried-from-HP5-partial` | 本轮未扩写 |
| F7 | tool workspace state machine | `carried-from-HP6-partial` | 本轮未扩写 |
| F8 | checkpoint / revert | `carried-from-HP7-partial` | 本轮未扩写 |
| F9 | runtime hardening | `partial-by-HP8` | root gate 三件套 + tool catalog SSoT + Lane E 终态已 live;heartbeat posture / R28 / R29 / consumer migration 未完 |
| F10 | R29 postmortem & residue verdict | `still-handed-to-platform` | HP8 第一波未起草;后续批次或 HP10 |
| F11 | API docs + 手工证据 | `partial-by-HP3-and-HP4` | HP9 |
| F12 | final closure | `not-touched` | HP10 |
| F13 | observability drift / metrics 完整性 | `partial-by-HP3/HP6/HP7-and-HP8` | HP8 增加 megafile / tool / envelope 三类 drift guard |
| F14 | tenant-scoped storage 全面落地 | `partial-by-HP6-and-HP7` | 本轮未扩写;Lane E retained 不影响 R2 key law |
| F15 | DO checkpoint vs product checkpoint registry 解耦 | `closed-by-HP1` | 本轮未触碰 |
| F16 | confirmation_pending kernel wait reason 统一 | `closed-by-HP5` | 本轮未触碰 |
| F17 | `<model_switch>` developer message strip-then-recover during compact | `partial-by-HP3` | 本轮未触碰 |

---

## 5. HP9 Freeze Gate Verdict

| Gate | 状态 |
|------|------|
| `check:cycles` | ✅ pre-existing |
| `check:observability-drift` | ✅ pre-existing |
| `check:megafile-budget` (HP8 P3-01) | ✅ live + clean |
| `check:tool-drift` (HP8 P3-02a) | ✅ live + clean |
| `check:envelope-drift` (HP8 P3-02b) | ✅ live + clean |
| heartbeat 4-scenario cross-e2e | ❌ **not run** |
| R28 explicit register (`closed / retained / handed-to-platform`) | ❌ **template only** |
| R29 explicit register | ❌ **not started** |
| Lane E final-state | ✅ frozen as `retained-with-reason` |
| tool catalog consumer migration | ⏳ catalog live, consumers still mirror locally |

**Verdict — HP9 documentation freeze gate: NOT GRANTED.**

理由:HP9 文档冻结的前置条件是“代码与 chronic register 已经稳定到不会在文档冻结期间继续漂移”。本轮 HP8 first wave 已经把 repo 漂移、tool contract、envelope public scope 三个守门点压紧;但 heartbeat posture(F9)与 R28 / R29 chronic 三选一终态仍处于 `partial / not-started` 状态。HP9 若在此时启动,会在 chronic register 仍可能更新的窗口内冻结 18 份对外文档,直接抵消 Q28 explicit closure 的价值。

**HP9 解锁条件**(满足任一即可走 HP10 而不再回头改 HP9):
1. R28 register 进入 `closed / retained-with-reason / handed-to-platform` 之一,Q28 4 字段齐全。
2. R29 register 同上。
3. heartbeat 4-scenario cross-e2e 全绿。
4. 或 owner 显式接受“HP9 文档冻结时,这三项以 `handed-to-platform` 形式固定移交,不再在 HP9 期间变更”。

---

## 6. 下游 phase / 后续批次交接

| 接收对象 | 交接物 | 形式 | 本 closure 引用 |
|----------|--------|------|----------------|
| HP8 后续批次 | R28 / R29 explicit register、heartbeat posture hardening、4-scenario cross-e2e、tool catalog consumer migration | 必修 | §2 P1-P5 + §5 解锁条件 |
| HP9 | 三类 root gate + tool catalog SSoT + Lane E 终态 + envelope public-only law | 文档输入 | §1 R1-R7 |
| HP10 | F1-F17 chronic register(本 closure §4 是 hero-to-pro 阶段倒数第二次同步) | 文档输入 | §4 |

---

## 7. 测试与证据矩阵

| 类型 | 命令 / 路径 | 状态 |
|------|-------------|------|
| typecheck (nacp-core) | `pnpm --filter @haimang/nacp-core typecheck` | ✅ |
| build (nacp-core) | `pnpm --filter @haimang/nacp-core build` | ✅ |
| test (nacp-core) | `pnpm --filter @haimang/nacp-core test` | ✅ 344/344 |
| typecheck (nacp-session) | `pnpm --filter @haimang/nacp-session typecheck` | ✅ |
| test (nacp-session) | `pnpm --filter @haimang/nacp-session test` | ✅ 196/196 |
| typecheck (orchestrator-core) | `pnpm --filter @haimang/orchestrator-core-worker typecheck` | ✅ |
| test (orchestrator-core) | `pnpm --filter @haimang/orchestrator-core-worker test` | ✅ 305/305 |
| test (agent-core) | `pnpm --filter @haimang/agent-core-worker test` | ✅ 1077/1077 |
| `pnpm run check:megafile-budget` | root | ✅ 5 owner files within budget |
| `pnpm run check:tool-drift` | root | ✅ 1 tool id (`bash`) registered |
| `pnpm run check:envelope-drift` | root | ✅ 1 public file clean |
| 新增 tool-catalog tests | `packages/nacp-core/test/tool-catalog.test.ts` | ✅ 7 |
| `pnpm test:cross-e2e` (HP8 4-scenario) | not run | n/a |

---

## 8. 收口意见

1. **可以确认收口的,是 HP8 的 first wave(repo gate 三件套 + tool catalog SSoT + Lane E final-state);chronic register 与 heartbeat posture 仍属于 HP8 后续批次。**
2. **可以立即被后续 phase / HP10 消费的,是 megafile / tool / envelope 三类 drift guard、`TOOL_CATALOG` SSoT、`lane-e-final-state.md` 终态。**
3. **HP9 documentation freeze gate 显式 NOT GRANTED。** 解锁条件见 §5;owner 可以选择补完 R28/R29/heartbeat 三件,也可以显式以 `handed-to-platform` 形式固定移交。
