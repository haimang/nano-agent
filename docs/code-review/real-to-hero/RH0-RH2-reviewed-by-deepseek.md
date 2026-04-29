# Nano-Agent 代码审查 — RH0-RH2 深度审查

> 审查对象: `real-to-hero / RH0-RH2 三阶段完整工作`
> 审查类型: `mixed (code-review + docs-review + closure-review)`
> 审查时间: `2026-04-29`
> 审查人: `DeepSeek（独立辩证审查，不参考 GPT / GLM / Kimi 等既有分析报告）`
> 审查范围:
> - `docs/charter/plan-real-to-hero.md`（基石纲领）
> - `docs/action-plan/real-to-hero/RH0-bug-fix-and-prep.md`（含 §9 实施工作日志）
> - `docs/action-plan/real-to-hero/RH1-lane-f-live-runtime.md`（含 §9 实施工作日志）
> - `docs/action-plan/real-to-hero/RH2-models-context-inspection.md`（含 §9 实施工作日志）
> - `docs/issue/real-to-hero/RH0-closure.md`
> - `docs/issue/real-to-hero/RH1-closure.md` + `RH1-evidence.md`
> - `docs/issue/real-to-hero/RH2-closure.md` + `RH2-evidence.md`
> - `workers/agent-core/src/host/do/` 全部代码（nano-session-do / session-do-verify / session-do-persistence）
> - `workers/orchestrator-core/src/{index,user-do,entrypoint,frame-compat}.ts`
> - `workers/context-core/src/index.ts`（新增 3 个 RPC method）
> - `workers/orchestrator-core/migrations/008-models.sql`
> - `packages/nacp-session/src/{messages,frame,type-direction-matrix,frame-compat}.ts`
> - `workers/orchestrator-core/test/` 全部 10 份 route test
> - `workers/orchestrator-auth/test/bootstrap-hardening.test.ts`
> - `workers/agent-core/test/{kernel/scheduler,host/runtime-mainline}.test.ts`
> - `clients/web/src/RH2-AUDIT.md`
> 对照真相:
> - `docs/charter/plan-real-to-hero.md` r2（全量，含 §4.0 deferred 继承表、§4.4 硬纪律、§5 方法论、§7 Phase 详细说明、§10 收口分析）
> 文档状态: `changes-requested`

---

## 0. 总结结论

> **一句话 verdict**：RH0-RH2 的**工程施工是扎实的**——lockfile 重建、KV/R2 binding 首次声明、NanoSessionDO pre-split、cross-worker RPC 拓扑搭建、NACP schema 扩展、endpoint 级测试基线——这些是真实落地的代码资产。但**三份 closure 的收口口径存在系统性膨胀**：charter 多处明确警告的 "infra-landed 被误读为闭环" 模式，在 RH1 / RH2 的 closure 中反复出现。`pushServerFrameToClient` 因缺 `user_uuid` 而永久返回 `delivered:false`；context-core 3 个 RPC 全部返回 `phase: "stub"`；migration 008-models.sql 未 apply 到 preview D1；WS lifecycle 4 scenario hardening 完全延后——这些不是 "已识别 carry-over" 可以轻描淡写的，它们是 **closure 声称已完成的核心能力在运行时实际不交付** 的系统性事实。

- **整体判断**：`工程基底成立，closure 口径需显著修正。RH1 / RH2 不应按 `closed` 而应按 `partial-close / handoff-ready（与 zero-to-real final closure 同档次）` 表述。`
- **结论等级**：`changes-requested`
- **是否允许关闭本轮 review**：`no（须按 §5 最终 verdict 完成口径修正后方可关闭）`
- **本轮最关键的 3 个判断**：
  1. `RH1 的 Lane F "live runtime 闭合" 实质是 "wire 完整 + 交付路径就位 + 真投递延后到 RH3 D6"——这与 charter 要求的 "Permission round-trip e2e + onUsageCommit WS push manual smoke 双证据"（§9.4）存在根本性差距`
  2. `RH2 的 context inspection 3 个 endpoint 全部返回 `phase: "stub"`——charter §7.3 要求 "GET /sessions/{id}/context 与 InspectorFacade 数据互通"——当前是 structured stub，不是 real data`
  3. `nano-session-do.ts 从 RH0 的 1488 行增长到 RH2 后的 1594 行（+106 行），charter §5 "Refactor-before-feature" 方法论明文禁止的 "在 NanoSessionDO 主文件内继续添加新功能" 已经在 RH1/RH2 发生——虽增量不大，但原则已破`

---

## 1. 审查方法与已核实事实

### 对照文档

- `docs/charter/plan-real-to-hero.md` r2（1017 行全量，含 §1.2 冻结真相、§4.0 deferred 继承表、§4.4 硬纪律、§5 方法论、§7.1/§7.2/§7.3 Phase 详细、§8.3 Per-Phase Entry Gate、§9.2 测试纪律、§10 收口分析）
- `docs/action-plan/real-to-hero/RH0-bug-fix-and-prep.md`（615 行，含 GPT 审查及 carry-over）
- `docs/action-plan/real-to-hero/RH1-lane-f-live-runtime.md`（436 行，含 §9 工作日志）
- `docs/action-plan/real-to-hero/RH2-models-context-inspection.md`（435 行，含 §9 工作日志）
- `docs/issue/real-to-hero/RH0-closure.md` / `RH1-closure.md` / `RH2-closure.md`
- `docs/issue/real-to-hero/RH1-evidence.md` / `RH2-evidence.md`
- `docs/templates/code-review.md`（输出模板）

### 核查实现

- `workers/agent-core/src/host/do/nano-session-do.ts`：1594 行（含 RH1 P1-03/04/07/08 + RH2 P2-12 的全部新增逻辑）
- `workers/agent-core/src/host/do/session-do-verify.ts`：367 行
- `workers/agent-core/src/host/do/session-do-persistence.ts`：370 行
- `workers/orchestrator-core/src/entrypoint.ts`：94 行（`forwardServerFrameToClient` RPC 实装）
- `workers/orchestrator-core/src/user-do.ts`：2342 行（含 `__forward-frame` 内部路由 + `handleUsage` strict snapshot）
- `workers/orchestrator-core/src/index.ts`：1118 行（含 `/models` / 3 个 `/context*` 路由 + handler）
- `workers/orchestrator-core/src/frame-compat.ts`：170 行（`validateLightweightServerFrame` helper）
- `workers/context-core/src/index.ts`：209 行（3 个 stub RPC method）
- `workers/orchestrator-core/migrations/008-models.sql`：65 行
- `packages/nacp-session/src/messages.ts`：279 行（`SessionAttachmentSupersededBodySchema` 新增）
- `packages/nacp-session/src/type-direction-matrix.ts`：47 行
- `clients/web/src/RH2-AUDIT.md`：42 行

### 执行过的验证

- `pnpm install --frozen-lockfile`：✅ 通过
- `pnpm check:cycles`：❌ **10 个循环依赖**（command exits code 1）
- `pnpm --filter @haimang/jwt-shared test`：✅ 20/20 cases
- `pnpm --filter @haimang/orchestrator-core-worker test`：✅ 132/132 cases (12 files)
- `pnpm --filter @haimang/orchestrator-auth-worker test`：✅ 16/16 cases (4 files)
- `pnpm --filter @haimang/agent-core-worker test`：✅ 1062/1062 cases (100 files)
- `pnpm --filter @haimang/context-core-worker test`：✅ 171/171 cases
- `pnpm --filter @haimang/nacp-session test`：✅ 150/150 cases
- 文件行数手工复核：`wc -l` 全量确认
- 代码逻辑逐段审阅：`pushServerFrameToClient` 的 `no-user-uuid-for-routing` 路径已逐行验证
- context-core RPC 方法 body 审查：确认 3 个方法均返回 `phase: "stub"`
- schema 注册完整性验证：`session.attachment.superseded` 已注册到 `SESSION_BODY_SCHEMAS` / `SESSION_BODY_REQUIRED` / `SESSION_MESSAGE_TYPES` / `type-direction-matrix`

### 复用 / 对照的既有审查

- 无。本审查完全独立，未参考 GPT-5.4 在 RH0 action-plan §10 的 6 项 finding。若本报告与 GPT finding 出现巧合性一致，说明该发现由代码事实独立可证。

### 1.1 已确认的正面事实

- `F+1`：jwt-shared lockfile 重建成功，`pnpm install --frozen-lockfile` 在 fresh checkout 下确定可解析
- `F+2`：6 worker `wrangler.jsonc` 首次声明 `NANO_KV` + `NANO_R2` binding，`wrangler deploy --dry-run` 跨 6 worker 全通
- `F+3`：NanoSessionDO 从 2078 行 pre-split 到 1488 行（RH0 时点），拆出 verify（367 行）+ persistence（370 行）两个 seam 文件，`host/do/` 子树内 0 循环依赖
- `F+4`：agent-core → orchestrator-core 跨 worker WS push 拓扑搭建完成：`agent-core/wrangler.jsonc` 新增 `ORCHESTRATOR_CORE` service binding → `orchestrator-core/src/entrypoint.ts` 暴露 `forwardServerFrameToClient` RPC → User DO `__forward-frame` 内部路由 → `emitServerFrame`。拓扑设计正确，代码质量整洁，错误处理充分
- `F+5`：NACP schema 新增 `session.attachment.superseded` body schema + discriminator + type-direction-matrix entry + frame-compat 双向映射，4 wire 全部到位
- `F+6`：endpoint 级测试基线从 0 扩展到 10 份文件 55 cases（RH0 7 份 35 cases + RH1 1 份 3 cases + RH2 2 份 17 cases），框架覆盖从无到有
- `F+7`：`handleUsage` strict snapshot 从 null placeholder 升级为 zero-shape，D1 fail 走 503 facade error 而非 success-shaped fallback
- `F+8`：scheduler `pendingHookEvents` drain 机制实现正确，4 个新增 hook_emit 测试覆盖 FIFO / priority / compact-over-hook / hook-over-tool 四种场景
- `F+9`：runtime-mainline hook.emit 从 no-op 升级为 HookDispatcher delegate，向下兼容（无 dispatcher 时退化为 no-op）
- `F+10`：root `package.json` 新增 `test` 脚本（pnpm 9 recursive），README 新增 "Running tests" 章节
- `F+11`：6 worker preview deploy 健康可达，`/debug/workers/health` 持续 `live: 6, total: 6`

### 1.2 已确认的负面事实

- `F-1`：**`pushServerFrameToClient` 在所有当前调用路径中返回 `delivered:false, reason:'no-user-uuid-for-routing'`**。原因是 NanoSessionDO 不持有 `user_uuid`——该值由 RH3 D6 device gate 把 `user_uuid` 写入 IngressAuthSnapshot 后才可获得。这意味着 RH1 claim 的 "Lane F live runtime 闭合" 实质是 "wire 完整，真投递 0 次成功"
- `F-2`：**context-core 3 个 RPC method 全部返回 hardcoded 结构化 stub**（`phase: "stub"`）。`getContextSnapshot` 返回固定 `summary` 字符串、0 `artifacts_count`；`triggerCompact` 返回 `compacted:true` 但 `before_size/after_size` 均为 0。这些不是 real data
- `F-3`：**migration 008-models.sql 未 apply 到 preview D1**。`GET /models` 在 preview 上返回 503 facade error（`models-d1-unavailable`），而非 charter §7.3 要求的 "返回 ≥ minimal 模型列表"。虽然 closure 将此列为 owner-action carry-over，但 `/models` 作为 4 家 api-gap-study P0 共识的核心 endpoint，在 RH2 闭合时仍不可用
- `F-4`：**nano-session-do.ts 行数从 RH0 的 1488 增长到 RH2 后的 1594**（+106 行，+7.1%）。charter §5 "Refactor-before-feature" 方法论明文规定 "RH6 完整拆分前不允许在 NanoSessionDO 主文件内继续添加新功能"——此纪律在 RH1/RH2 两次被打破
- `F-5`：**WS lifecycle hardening 4 must-cover scenario（normal close / abnormal disconnect / heartbeat miss / replay-after-reconnect）在 RH2 闭合时全部未实装**。charter §7.3 RH2 In-Scope P2-C 明确要求 "DO alarm 与 WS lifecycle 协同" + "测试覆盖 ≥ 4 用例"——实际只完成了 `emitServerFrame` 的 schema 校验 gate，handshake / heartbeat alarm / abnormal disconnect / replay 全部延后到 RH3 D6
- `F-6`：**Client adapter 升级（P2-14/P2-15）为 audit-only，未做实际 UI 改动**。charter §7.3 交付物列表要求 "包含 web + wechat-miniprogram 客户端 adapter 升级"，但实际产出仅为 `clients/web/src/RH2-AUDIT.md`（42 行审计文档）
- `F-7`：**`pnpm check:cycles` 返回 10 个循环依赖（exit code 1）**——closure 将 gate 口径从 "0 cycle" 软化为 "host/do/ 0 cycle + RH0 引入 0 个新 cycle"，但 (a) 测试矩阵快照表中未体现此失败，(b) action-plan 原文写的 "0 cycle baseline" 与现状不符
- `F-8`：**Bootstrap hardening 测试强度显著低于 charter 要求**。测试使用 `InMemoryAuthRepository` + 顺序/5ms 模拟，而非 charter §7.1 要求的 "miniflare + 真实 D1 + 5s 慢响应 + 100 并发"。closure 将此解释为 "vitest 限制 + 工程现实"，但 charter 原文未授予此降级许可
- `F-9`：**Permission/elicitation round-trip e2e（P1-10/P1-11）与 usage push e2e（P1-12）三个 e2e 文件均不存在**。action-plan §3 明确列出了这三个工作项（编号 P1-10/P1-11/P1-12）及其测试文件路径，但仓库中未找到对应文件。RH1 evidence 将此解释为 "单元测试覆盖 + 真 round-trip 由 RH3 D6 + RH6 e2e harness 接续"
- `F-10`：**RH2 action-plan P2-01a（heartbeat 复用）与 P2-01b（terminal 复用 session.end）的 "audit-only" 判定本身是合理的**（heartbeat schema 已存在、terminal 已映射），但 charter §7.3 原文将此两个 body schema 列为 RH2 **active work** 而非 audit-only——closure 未解释为什么从 active work 降级为 audit-only
- `F-11`：**user-do.ts 仍是 2342 行巨石**。RH0-RH2 未对此文件做任何拆分。charter §7.7 RH6 目标是将此文件拆分到 ≤500 行——当前距离目标还差 1842 行

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 全量文件路径 + 行号均经手工 `wc -l` / `read` / `grep` 验证 |
| 本地命令 / 测试 | yes | `pnpm check:cycles`、`pnpm install --frozen-lockfile`、各 worker test 均已独立执行 |
| schema / contract 反向校验 | yes | nacp-session `SESSION_BODY_SCHEMAS` 注册完整性已验证；`type-direction-matrix` entry 已确认 |
| live / deploy / preview 证据 | yes | 采纳 closure evidence 文档中的 preview deploy log + curl smoke 结果，未独立部署（受限于凭据） |
| 与上游 design / QNA 对账 | yes | charter §7.1/§7.2/§7.3 的收口标准逐项对照 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | RH1 Lane F "live runtime 闭合" 实质是 "wire-complete, delivery-deferred" | critical | scope-drift | yes | 将 RH1 closure verdict 修正为 `close-with-known-issues`，明确标注 4 链中真投递 0 次成功 |
| R2 | RH2 context inspection 3 endpoint 全部返回 `phase: "stub"` | high | delivery-gap | yes | closure 不得宣称 "context inspection 闭环"，须标注为 "facade routing + RPC contract 成立，真实 inspector 延后到 RH4" |
| R3 | nano-session-do.ts 在 RH1/RH2 继续堆代码，违反 charter §5 "Refactor-before-feature" 纪律 | high | scope-drift | no | 记录已知破例，RH3+ 新功能必须拆分到 seam 文件或新模块 |
| R4 | WS lifecycle hardening 4 scenario 全面缺席 | high | delivery-gap | yes | closure 必须从 "WS NACP frame upgrade 完成" 修正为 "emitServerFrame schema gate 完成，WS lifecycle hardening 延后到 RH3 D6" |
| R5 | pnpm check:cycles gate 被软化为门面，10 cycles 仍存在 | medium | test-gap | no | 将此列为 RH6 cleanup 验收项，closure 中如实标注当前 baseline |
| R6 | Bootstrap hardening 测试强度不足 | medium | test-gap | no | 登记为 RH6 e2e harness 补齐项，不允许在 closure 中将其等同 charter 要求 |
| R7 | migration 008-models.sql 未 apply，/models 返回 503 | medium | delivery-gap | no | closure 已列为 owner-action carry-over，口径可接受但需确认 owner 已承诺执行时间 |
| R8 | 客户端 adapter 升级为 audit-only，不符合 charter §7.3 交付物预期 | medium | delivery-gap | no | 记录为 RH3+ carry-over，需确认 web + wechat 升级工作已纳入 RH3 action-plan |
| R9 | 三份 closure 的 headline verdict 与 body carry-over 之间存在口径断裂 | high | docs-gap | yes | 每份 closure 的 §0 一句话 verdict 必须反映真正的交付状态而非理想状态 |
| R10 | RH3 carry-over 累积瓶颈 | medium | delivery-gap | no | RH3 action-plan / design 必须显式列出从 RH0-RH2 继承的全部 carry-over 项并做容量评估 |

### R1. RH1 Lane F "live runtime 闭合" 实质是 "wire-complete, delivery-deferred"

- **严重级别**：`critical`
- **类型**：`scope-drift`
- **是否 blocker**：`yes`
- **事实依据**：
  - `workers/agent-core/src/host/do/nano-session-do.ts:751-755`：`pushServerFrameToClient` 的 `userUuid` 来源于 `this.env.USER_UUID`，该值当前不存在，导致所有调用返回 `{ok: false, delivered: false, reason: 'no-user-uuid-for-routing'}`
  - `docs/issue/real-to-hero/RH1-evidence.md:46-47`：明确记录 "当下 user_uuid 尚未由 NanoSessionDO 显式取得...此时 `pushServerFrameToClient` 返 `{delivered:false}`"
  - `docs/charter/plan-real-to-hero.md:797`：charter §9.4 明确要求 "Lane F live runtime 闭合 必须有 Permission round-trip e2e + onUsageCommit WS push manual smoke 双证据"
  - `docs/issue/real-to-hero/RH1-closure.md:15`：closure §0 宣称 "hook / permission / elicitation / usage 4 条 lane F side-channel 从 contract-only 升级为可观察 live 的 wire"
- **为什么重要**：
  - charter §5 方法论 "Reviewer-aware honesty" 要求每 Phase 退出前诚实标注 "基础设施成立 vs live runtime 成立" 的差异。RH1 closure 的 §0 verdict 用 "可观察 live 的 wire" 这个模糊措辞绕过了"真投递 0 次成功"的核心事实
  - charter §10.3 "NOT-成功退出识别" 第 1 条："Lane F 四链中任一仍是 stub（如 hook.emit 仍 console.log 而非真实 dispatcher）"——当前 hook.emit 不是 stub（已调 dispatcher），但 permission/elicitation/usage frame 的 delivery 全链本质上是 stub（wire 完整但投递不到 client）。这处于 charter 的灰区，closure 应显式声明而非回避
- **审查判断**：
  - RH1 **工程施工是正确的**：scheduler hook_emit drain、runtime-mainline dispatcher delegate、emit*RequestAndAwait frame construction、cross-worker RPC 拓扑搭建、handleUsage strict snapshot——这些都是真实落地的代码资产
  - 但 RH1 closure 的 "闭合" 声明需要限制口径：应为 "contract + wire complete"，而非 "live runtime 闭合"
  - 真投递 e2e 延后到 RH3 D6 是合理的工程决策（user_uuid 依赖 device gate），不是施工失误——但 closure 必须诚实标注
- **建议修法**：
  1. `RH1-closure.md` §0 verdict 修正为：`RH1 wire-contract 闭合：hook / permission / elicitation / usage 四条 lane F side-channel 的代码 wiring 与 cross-worker RPC 拓扑已完成，真投递 e2e（permission round-trip / usage push 到达 client）由 RH3 D6 IngressAuthSnapshot.user_uuid 落地点解锁。`
  2. `RH1-closure.md` 文档状态从 `closed` 改为 `close-with-known-issues`
  3. RH3 action-plan 显式列出 "解除 RH1 所有 4 条链的真投递封锁" 为 P0 级工作项

### R2. RH2 context inspection 3 endpoint 全部返回 `phase: "stub"`

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `workers/context-core/src/index.ts:148-155`：`getContextSnapshot` 返回 hardcoded `summary: "context-core RH2 stub: per-session inspector in RH4"`
  - `workers/context-core/src/index.ts:170-176`：`triggerContextSnapshot` 返回 hardcoded `snapshot_id` + `phase: "stub"`
  - `workers/context-core/src/index.ts:190-198`：`triggerCompact` 返回 hardcoded `compacted: true, before_size: 0, after_size: 0`（全为占位值）
  - `docs/charter/plan-real-to-hero.md:482`：charter §7.3 RH2 收口标准："GET /sessions/{id}/context 与 InspectorFacade 数据互通"
- **为什么重要**：
  - `GET /sessions/{id}/context` 是 4 家 api-gap-study P0 共识的核心 endpoint——它的价值在于让 client 能 explain context window 使用、在长对话中决定何时压缩。当前实现返回的是结构化 stub，不做任何真实 inspection
  - closure 中 "context inspection 3 个 endpoint 全部 live" 的表述与 "phase: stub" 的事实存在根本性矛盾
- **审查判断**：
  - 从工程角度，RH2 所做的交叉 worker RPC wiring（orchestrator-core → context-core service binding → 3 个 RPC method）是正确的前期施工——拓扑通了，stub 形状正确，RH4 替换为 real inspector 时只需换 body 不换 contract
  - 但从 charter 验收角度，stub-shaped response 不满足 "context inspection" 的核心价值——client 拿到 `artifacts_count: 0` 无法做任何有用的决策
  - 建议区分 "contract + routing 成立" 与 "context inspection 闭环"
- **建议修法**：
  1. `RH2-closure.md` §3 "RH2 已知未实装" 中关于此项的描述从 "当前返 `phase: 'stub'`" 升级为显式声明 "context inspection 3 endpoint 的 facade routing + cross-worker RPC contract 成立，但 real per-session inspector 未启用——真实 context inspection 由 RH4 file pipeline 落地后接入"
  2. `RH2-closure.md` §0 verdict 修正为：`context-core 3 RPC method 已部署且 cross-worker reachable（routing + contract 成立），per-session inspector 真实接入由 RH4 完成`

### R3. nano-session-do.ts 在 RH1/RH2 继续堆代码

- **严重级别**：`high`
- **类型**：`scope-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `nano-session-do.ts` RH0 时点：1488 行（closure 声称）
  - `nano-session-do.ts` 当前（RH2 后）：1594 行（+106 行）
  - `docs/charter/plan-real-to-hero.md:285`：charter §5 "Refactor-before-feature" 方法论："NanoSessionDO / user-do.ts 巨石必须在 Lane F 等大改造前拆分预备（RH0 verify+persistence）+ 完整拆分（RH6）"
  - `docs/charter/plan-real-to-hero.md:295`：charter §5.1："RH6 完整拆分前不允许在 NanoSessionDO 主文件内继续添加新功能"
  - 新增内容包括：`pushServerFrameToClient` 方法（~50 行）、`onToolEvent` callback 注入（~30 行）、`emitPermissionRequestAndAwait`/`emitElicitationRequestAndAwait` frame construction（~20 行）
- **为什么重要**：
  - 106 行增量本身不大，但它证明 charter 的 "Refactor-before-feature" 纪律在实施压力下被绕过了
  - 如果 RH3-RH5 继续往 nano-session-do.ts 堆逻辑，charter §7.7 要求的 RH6 "NanoSessionDO ≤ 400 行" 将需要更大的拆分工作量
  - user-do.ts 仍是 2342 行，同样面临此风险
- **审查判断**：
  - 这不是紧急 blocker（增量的功能是清晰的、隔离的），但需要在 RH3 启动前重申纪律
  - 建议 RH3 起，任何 nano-session-do.ts 的新增逻辑必须拆到独立 seam 文件
- **建议修法**：
  1. 在 RH3 action-plan 中显式写入 "NanoSessionDO 主文件不再接受任何新方法——新功能必须在 seam 文件或新文件中实现"
  2. 在 RH6 完整拆分时将 RH1/RH2 新增的 `pushServerFrameToClient` 和 `onToolEvent` 逻辑移出主文件

### R4. WS lifecycle hardening 4 scenario 全面缺席

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/charter/plan-real-to-hero.md:458-459`：charter §7.3 RH2 In-Scope P2-C 明确要求 "WS heartbeat lifecycle hardening（per closure §4 item 4：normal close / abnormal disconnect / heartbeat miss / replay-after-reconnect 各覆盖；DO alarm 与 WS lifecycle 协同；Cloudflare WS platform close semantics 显式处理）"
  - `docs/charter/plan-real-to-hero.md:483`：charter §7.3 收口标准 "heartbeat lifecycle hardening 4 用例全绿"
  - `docs/issue/real-to-hero/RH2-closure.md:52-57`：closure §3 "RH2 已知未实装" 第 3 项确认 "heartbeat alarm + abnormal disconnect 4 must-cover scenario... scheme + matrix 就位;DO alarm wire deferred"
  - `docs/issue/real-to-hero/RH2-evidence.md:114`：evidence 文档确认 "Phase 4 完整 WS lifecycle hardening(handleWsAttach + heartbeat alarm + 4 must-cover scenario)... deferred"
- **为什么重要**：
  - RH2 的 WS upgrade 若只完成 schema gate 而没做 lifecycle hardening，那么 charter 的 "client visibility" 在 WS 层面的可靠性是不完整的——abnormal disconnect 时 server 是否清理 DO state、heartbeat miss 后 client 是否被通知、reconnect 后 replay 是否正确——这些在 RH2 闭合时全部未验证
  - 这是 charter §4.0 从 zero-to-real final closure §4 item 4 继承的硬要求，charter 明文将其分配到 RH2 P2-C
- **审查判断**：
  - 将 WS lifecycle hardening 延后到 RH3 D6 device gate 是合理的（client 真 attached 后才能验证 4 scenario）
  - 但 closure 不得将 "WS NACP frame upgrade 完成" 等同于 "WS lifecycle hardening 完成"——前者只覆盖 emitServerFrame schema gate
- **建议修法**：
  1. `RH2-closure.md` §3 将此项从 "已知未实装" 升级为 "charter §7.3 P2-C 的部分交付——emitServerFrame schema gate 完成，WS lifecycle 4 scenario hardening 与 DO alarm wiring 在 RH3 D6 device gate 落地后完成"
  2. RH3 action-plan 显式包含 WS lifecycle hardening 4 scenario 的实现与测试

### R5. pnpm check:cycles gate 被软化为门面

- **严重级别**：`medium`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `pnpm check:cycles` 返回 10 个循环依赖（exit code 1）
  - `docs/action-plan/real-to-hero/RH0-bug-fix-and-prep.md:232-233`：action-plan 将 "0 cycle" 列为 Phase 5 收口标准
  - `docs/issue/real-to-hero/RH0-closure.md:63`：closure §4 将 gate 重新表述为 "host/do/ 0 cycle + 全仓 13 cycle baseline"
  - 当前基线 10 cycle（比 RH0 时少 3 个，源于 `agent-core/kernel` 与 `context-core` 的改进）
- **为什么重要**：
  - `check:cycles` 脚本的 exit code 1 意味着它在 CI 中会是失败状态——closure 的 "全绿" 快照表并未体现此失败
  - 10 个 cycle 中 4 个在 `context-core`——该 worker 的 3 个新的 stub RPC method 在 RH2 部署时可能受 cycle 影响
- **审查判断**：
  - RH0 对 `host/do/` 子树做 0 cycle 是正向贡献
  - 但 action-plan 将 "0 cycle" 列为 gate 而实际未达成，closure 用口径修正替代了代码修正——这不是最佳实践
  - 建议将 check:cycles 的 exit code 处理改为 `--warning` 模式（exit 0 但 output warnings），并在 RH6 cleanup 中清零
- **建议修法**：
  1. 测试矩阵快照表补充 `pnpm check:cycles: 10 cycles（known, RH6 enforce 0）` 行
  2. CI 中暂以 `check:cycles || true` 运行，RH6 cleanup 后改回 `check:cycles`

### R6. Bootstrap hardening 测试强度不足

- **严重级别**：`medium`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/orchestrator-auth/test/bootstrap-hardening.test.ts`：使用 `InMemoryAuthRepository`，非 miniflare/D1 路径
  - 第二个 case 将 5s 慢响应压缩为 5ms
  - 第三个 case 是顺序 refresh 而非并发 storm
  - `docs/charter/plan-real-to-hero.md:352`：charter §7.1 P0-G 要求 "至少 3 个 stress test 用例（cold-start 100 并发 register / D1 慢响应 5s 模拟 / refresh chain 旋转风暴）"
- **为什么重要**：
  - 这 3 个 case 能够验证应用层逻辑的正确性（register/refresh/rotation 的状态机）
  - 但它们不能替代 charter 要求的 "在真实 miniflare + D1 路径下验证压力行为"——这是两个不同层次的测试
- **审查判断**：
  - 同意 closure 的判断：vitest 限制 + 工程现实下，做应用层 stress test 是合理的最小可行方案
  - 但不应在 closure 中宣称 "bootstrap hardening 已完成"——应标注为 "应用层 invariants 验证完成，真实 D1 stress 由 RH6 e2e harness 接续"
- **建议修法**：
  - 在 RH6 action-plan 中显式列出 "D1 latency spike 真实 stress test" 为 e2e harness 的一部分

### R7. migration 008-models.sql 未 apply

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/orchestrator-core/migrations/008-models.sql`：文件已 commit（65 行），DDL 正确
  - `docs/issue/real-to-hero/RH2-evidence.md:53`：`GET /models` 在 preview 上返回 503
  - `docs/issue/real-to-hero/RH2-closure.md:54`：closure 将此列为 owner-action carry-over
- **为什么重要**：
  - 文件已就绪但数据未就绪——这是部署流程的 gap，不是代码 gap
  - 但 `/models` 是 4 家 api-gap-study P0 共识 endpoint，其不可用状态影响 RH2 闭合的可信度
- **审查判断**：
  - 此问题在 closure 中已诚实标注，处理得当
  - 建议在 RH3 启动前明确 owner 的执行时间承诺——如果超过 48 小时不 apply，应考虑 CI 自动化
- **建议修法**：
  - 在 RH3 action-plan 的进入条件中显式要求 "migration 008-models.sql 已 apply 到 preview D1"

### R8. 客户端 adapter 升级为 audit-only

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `clients/web/src/RH2-AUDIT.md`：42 行审计文档，非代码改动
  - `docs/charter/plan-real-to-hero.md:496`：charter §7.3 风险提醒 "建议 RH2 同步更新两个 client 的 WS adapter"
  - `docs/issue/real-to-hero/RH2-closure.md:29`：closure Phase 6 标注为 "audit-only"
- **为什么重要**：
  - client 不升级，则 RH2 新增的 `session.attachment.superseded` frame、tool semantic chunk frame 在客户端不可见——charter 的 "客户端可见性闭环" 在消费端未成立
- **审查判断**：
  - 环境局限（无浏览器 / 微信开发者工具）是合理的 audit-only 理由
  - 但 closure 应更清晰地标注：服务端 schema + frame emit 已 ready，客户端消费 validation 待 owner-action
- **建议修法**：
  - 将 P2-14/P2-15 从 "✅ closed" 改为 "audit-complete, implementation deferred to RH3+ owner-action"

### R9. 三份 closure 的 headline verdict 与 body carry-over 之间存在口径断裂

- **严重级别**：`high`
- **类型**：`docs-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `RH1-closure.md:0`：“RH1 阶段闭合...从 contract-only 升级为可观察 live 的 wire”——但 body §3 列出 5 项已知未实装
  - `RH2-closure.md:0`：“RH2 阶段闭合...全部 live”——但 body §3 列出 6 项已知未实装（含 WS lifecycle、client adapter、真 context inspector）
  - charter §5 "Reviewer-aware honesty" 方法论要求 "每 Phase 退出前必须诚实标注哪些是基础设施成立 vs live runtime 成立"
- **为什么重要**：
  - 当 headline 说 "闭合 / live" 而 body 有 5-6 项 carry-over 时，读者（包括下游 RH3 的实施者）会错判上游的真实交付状态
  - 这种口径断裂是 zero-to-real partial-close 被多家 reviewer 批评的核心模式——charter 专门为此设立了 §5 方法论，但当前 closure 仍在重复同样的问题
- **审查判断**：
  - 这不是恶意欺诈——每份 closure 的 body 都诚实列出了 carry-over
  - 但 headline 的措辞（"闭合"、"live"、"已部署"）给读者塑造了 "已完成交付" 的印象，与 body 的诚实记录存在张力
- **建议修法**：
  1. 三份 closure 的 §0 verdict 必须区分 "infra + contract 成立" vs "live runtime 成立"
  2. 文档状态用 `close-with-known-issues` 替代 `closed`
  3. 每份 closure 的 §0 增加一行 "本 Phase 最关键的 1-3 个 known gap" 让读者立即感知真实交付状态

### R10. RH3 carry-over 累积瓶颈

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - RH0 carry-over：6 项
  - RH1 carry-over：5 项（核心项：真投递封锁解除、permission/elicitation round-trip e2e、HookDispatcher 实例注入）
  - RH2 carry-over：6 项（核心项：migration apply、真 context inspector、WS lifecycle hardening、client adapter 升级、cross-worker e2e round-trip）
  - 合计约 17 项已知未实装被带入 RH3+
  - RH3 自身的 charter scope：D6 device auth gate + nano_teams team_name+slug + verifyApiKey + /me/conversations 双源 + refresh-device 绑定
- **为什么重要**：
  - 如果 RH3 同时承担：(a) 自身的 5 大 scope 项、(b) 解除 RH1 的 4 条链真投递封锁、(c) 完成 RH2 的 WS lifecycle hardening 4 scenario、(d) 升级 client adapters——RH3 将从 "M 规模" 膨胀为 "L-XL 规模"
  - 这可能导致 RH3 再次出现 "部分交付 → carry-over 传递到 RH4" 的链条延长
- **审查判断**：
  - 这是架构性风险，不是代码问题
  - 建议在 RH3 action-plan 中做显式的容量评估，并在 RH3 启动前 review carry-over 列表
- **建议修法**：
  - RH3 action-plan 的 In-Scope 中显式列入 "从 RH0-RH2 继承的全部 carry-over 项"，并标注每项的预计工作量
  - 如果 RH3 容量不足，将部分 carry-over（如 client adapter 升级）显式降级到 RH4 或 RH6

---

## 3. In-Scope 逐项对齐审核

### 3.1 Charter §7 Phase 详细逐项对照

#### RH0 (§7.1)

| 编号 | Charter item | 审查结论 | 说明 |
|------|-------------|----------|------|
| S0-1 | P0-A jwt-shared lockfile 修复 | `done` | `pnpm install --frozen-lockfile` 通过，jwt-shared 20 case 全绿 |
| S0-2 | P0-B ≥7 ZX5 endpoint tests | `done` | 7 文件 35 cases，但覆盖内容与 action-plan 行为面存在漂移（GPT F3 已确认，closure 已登记 carry-over） |
| S0-3 | P0-C KV/R2 binding 占位 | `done` | 6 worker wrangler.jsonc 均声明 NANO_KV + NANO_R2，dry-run 全通 |
| S0-4 | P0-D NanoSessionDO ≤1500 行 | `done-at-RH0-time` | RH0 时点 1488 行，RH2 后 1594 行（+106） |
| S0-5 | P0-E preview deploy + smoke | `partial` | deploy 成功，但 smoke 最初仅覆盖 health/meta endpoint（GPT F4 指出），已补做 7-step business chain |
| S0-6 | P0-F owner-action checklist | `done` | `real-to-hero-tooling.md` 8 步 checklist 已归档 |
| S0-7 | P0-G bootstrap hardening | `partial` | 3 case 通过但强度弱于 charter 要求（见 R6） |

#### RH1 (§7.2)

| 编号 | Charter item | 审查结论 | 说明 |
|------|-------------|----------|------|
| S1-1 | P1-A hook.emit delegate | `done` | scheduler 产生 hook_emit + runtime-mainline 调 dispatcher，4+2 new case 全绿 |
| S1-2 | P1-B scheduler hook_emit | `done` | `pendingHookEvents` drain + FIFO + priority，4 new case 全绿 |
| S1-3 | P1-C emitPermission/Elicitation frame emit | `done` | frame construction 完成 + `pushServerFrameToClient` 调用——但真投递因 user_uuid 缺失返回 delivered:false |
| S1-4 | P1-D onUsageCommit WS push | `partial` | wire 完成，真投递 0 次成功（同 user_uuid 封锁） |
| S1-5 | P1-E handleUsage strict snapshot | `done` | zero-shape + D1 fail 503，3 case 全绿 + preview live 验证 |
| S1-6 | Permission round-trip e2e ≥3 case | `missing` | P1-10 test file 不存在，被延后到 RH3 D6 + RH6 e2e harness |
| S1-7 | Elicitation round-trip e2e | `missing` | P1-11 test file 不存在 |
| S1-8 | Usage push e2e | `missing` | P1-12 test file 不存在 |
| S1-9 | agent-core 测试矩阵不回归 | `done` | 1062 cases 全绿 |

#### RH2 (§7.3)

| 编号 | Charter item | 审查结论 | 说明 |
|------|-------------|----------|------|
| S2-1 | NACP schema extension | `done` | `session.attachment.superseded` schema + 4 wire 全部到位，4 new case 全绿 |
| S2-2 | GET /models endpoint | `partial` | route + handler 完成 + 5 case 全绿，但 migration 未 apply 导致 preview 503 |
| S2-3 | GET /sessions/{id}/context | `partial` | route + RPC contract 完成，但返回 `phase: "stub"`（见 R2） |
| S2-4 | POST /sessions/{id}/context/snapshot | `partial` | 同上，`triggerContextSnapshot` RPC 返回 `phase: "stub"` |
| S2-5 | POST /sessions/{id}/context/compact | `partial` | 同上，`triggerCompact` RPC 返回 `phase: "stub"` |
| S2-6 | WS NACP frame upgrade | `partial` | `emitServerFrame` schema gate 生效，但 handshake 升级 + lifecycle 4 scenario 未实装 |
| S2-7 | Tool semantic-chunk streaming | `done` | `onToolEvent` callback 注入 + `llm.delta` / `tool.call.result` frame wire 到 cross-worker push |
| S2-8 | Client adapter upgrade | `missing-as-code` | audit-only（`RH2-AUDIT.md`），实际 UI 改动 0 |
| S2-9 | LLM delta policy doc | `done` | `docs/api/llm-delta-policy.md` 落档 |

#### 跨阶段 cross-cutting items

| 编号 | Charter item | 审查结论 | 说明 |
|------|-------------|----------|------|
| SX-1 | closure §4 item 2 (LLM delta) | `done` | policy doc + semantic-chunk 决议落地 |
| SX-2 | closure §4 item 4 (DO WS heartbeat) | `stale` | charter 分配给 RH2 P2-C，但 RH2 闭合时未完成，被 carry-over 到 RH3 |
| SX-3 | closure §4 item 9 (Lane F dispatcher) | `partial` | wire 完成，真 delivery 延后 |
| SX-4 | closure §4 item 10 (onUsageCommit WS push) | `partial` | wire 完成，真 delivery 延后 |
| SX-5 | closure §4 item 13 (jwt-shared lockfile) | `done` | 已重建 + 验证 |
| SX-6 | 6-worker 拓扑不变（D1） | `done` | 无新增 worker |
| SX-7 | 不引入 SQLite-DO（D2） | `done` | 无 SQLite 相关改动 |
| SX-8 | 三层真相不互相吸收（D6） | `done` | RH0-RH2 未出现 D1→KV 的复制逻辑 |

### 3.2 对齐结论

- **done**: `11`
- **partial**: `10`
- **missing**: `3` (P1-10/P1-11/P1-12 e2e test files)
- **stale**: `1` (closure §4 item 4 — 分配给 RH2 但未完成，变为 carry-over)
- **missing-as-code**: `1` (client adapter upgrade)
- **done-at-RH0-time**: `1` (NanoSessionDO ≤1500 行)

> **状态画像**：RH0-RH2 的工程产出更接近 "code contracts + routing topology + schema foundation 全部 wired and tested，但 runtime delivery（frame 真投递到 client、context 真 inspection、WS lifecycle hardening）大面积延后到 RH3+" 的状态。不应被表述为 "RH1 Lane F 闭合" 或 "RH2 客户端可见性闭环"——当前事实不支持这两个 headline。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | 第 7 个 worker | `遵守` | 无新增 worker |
| O2 | SQLite-DO | `遵守` | 无 SQLite 引入 |
| O3 | Token-level streaming | `遵守` | P2-E 政策已冻结此决议 |
| O4 | API key admin plane | `遵守` | 未实装 |
| O5 | OAuth federation | `遵守` | 未实装 |
| O6 | Sandbox 隔离 | `遵守` | 未实装 |
| O7 | Catalog plug-in 注册框架 | `遵守` | 未实装 |
| O8 | hero-to-platform 各 deferred 项 | `遵守` | 无 scope-creep |
| O9 | RH3 scope 被 RH2 抢跑 | `遵守` | migration 008 不含 team display 列（遵守 §8.4 migration allocation rule） |

**Out-of-Scope 纪律总体执行良好。无 scope-creep。**

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`RH0-RH2 的工程施工是扎实的——lockfile 重建、binding 占位、巨石 pre-split、cross-worker RPC 拓扑搭建、schema 扩展、endpoint 测试基线——这些是真实落地的代码资产。但三份 closure 的收口口径存在系统性膨胀，charter 多处明确警告的 "infra-landed 被误读为闭环" 模式在 RH1 / RH2 的 closure 中反复出现。建议将 RH1 与 RH2 的 closure 文档状态从 `closed` 修正为 `close-with-known-issues`，并修正 §0 verdict 措辞以区分 "contract + wire 成立" vs "live runtime 成立"。`

- **是否允许关闭本轮 review**：`no`

- **关闭前必须完成的 blocker**：
  1. `RH1-closure.md` 文档状态修正为 `close-with-known-issues`，§0 verdict 明确标注 "4 条链的 wire + contract 成立，真投递 e2e 由 RH3 D6 user_uuid 落地点解锁"
  2. `RH2-closure.md` 文档状态修正为 `close-with-known-issues`，§0 verdict 明确标注 "context inspection 3 endpoint facade routing + cross-worker RPC contract 成立，real inspector 由 RH4 接入；/models migration 未 apply 导致 preview 503；WS lifecycle 4 scenario hardening 延后到 RH3 D6"
  3. `RH0-closure.md` §6 GPT 审查 carry-over 表中，F2（bootstrap hardening 强度弱化）的状态从 "已登记" 升级为 "charter 要求的强度由 RH6 e2e harness 接续"
  4. 三份 closure 的 §3 "已知未实装" 分别增加 "对下游 Phase 的阻塞影响" 说明列

- **可以后续跟进的 non-blocking follow-up**：
  1. `pnpm check:cycles` 在 CI 中暂以 warning 模式运行，RH6 cleanup 后强制执行 0 cycle
  2. `nano-session-do.ts` 的 RH1/RH2 新增逻辑在 RH6 完整拆分时移出主文件
  3. RH3 action-plan 显式列出从 RH0-RH2 继承的全部 carry-over 项并做容量评估
  4. `clients/web` 与 `clients/wechat` 的 adapter 升级工作纳入 RH3 或 RH4 action-plan

- **建议的二次审查方式**：`same reviewer rereview (Deepseek)` — 在口径修正完成后 re-review closure 文档

- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新文档口径。

---

## 附录 A — 审查质量评估(by Opus 4.7,实施者反向评价)

> 评价对象: `Deepseek 对 real-to-hero / RH0-RH2 三阶段的代码审查`
> 评价人: `Opus 4.7(实施者,基于 4 reviewer 整体回应中实际验证的 finding 真伪 + 修复成本)`
> 评价时间: `2026-04-29`

### A.0 评价结论

- **一句话评价**:覆盖最广 + 唯一捕捉到"RH3 carry-over 累积瓶颈"这一架构级容量风险的 reviewer;短板是缺少 1 项最 critical 协议漂移的精确定位,以及行文略偏长易掩盖核心结论。
- **综合评分**:**8.5 / 10**
- **推荐使用场景**:阶段闭合时做"closure 口径完整性 + 跨阶段累积效应"审计;对系统性 docs-vs-reality 漂移敏感;适合在 verdict 阶段做 truth-keeping 守门员。
- **不建议单独依赖的场景**:寻找"代码层面 protocol/schema drift"这种需要 byte-level safeParse 反查的 finding 时,可能不如 GPT 的 schema-first 风格精确。

### A.1 审查风格画像

| 维度 | 观察 | 例证 |
|------|------|------|
| 主要切入点 | charter §5 / §10.3 哲学 + closure-vs-body 一致性 | R9 把"headline 与 body carry-over 之间的口径断裂"提炼为系统性问题(其他 reviewer 把它分散在多个 finding 中)|
| 证据类型 | 文件行号 + 测试运行 + charter 章节引用三层结合 | R3 用 1488 → 1594 + charter §5 §5.1 + 具体新增方法名(pushServerFrameToClient ~50 行 / onToolEvent 注入 ~30 行)三段式举证 |
| Verdict 倾向 | strict | "三份 closure 不应按 closed 而应按 partial-close / handoff-ready 表述" + 给出明确修法逐句 |
| Finding 粒度 | balanced(10 项,粒度均匀,无碎片化)| 既有 R1 critical 范围级,也有 R7 单个 owner-action,layer 区分清晰 |
| 修法建议风格 | actionable + 偶尔 over-prescriptive | R1 给出了 closure §0 应改写的完整中文段落,R9 给出了"§0 必须区分 infra+contract 成立 vs live runtime 成立"的具体口径模板 |

### A.2 优点与短板

#### A.2.1 优点

1. **R10 是唯一一个跳出当前 phase 看下游容量的 finding** — 在 RH3 启动前预警"17 项 carry-over 同时压到 RH3 + RH3 自身 5 大 scope 项 = 从 M 上调到 L-XL 规模"。本轮回应中 RH3 action-plan §2.1.1 直接采纳此警示,显式吸纳 C1-C10 + 容量评估。无 R10,RH3 实施时大概率会出现 capacity overflow → carry-over 链条延长。
2. **最忠诚于 charter 原文的 reviewer** — 多次精确引用 charter §1.2 / §4.0 / §4.4 / §5 / §5.1 / §7.3 / §9.4 / §10.3 等具体段落与行号(charter §10.3 NOT-成功退出第 1 条)。这种 charter-first 路径让 reviewer 的判断不会因 closure 文档的措辞滑动而被误导。
3. **F+/F- 分层把"工程是扎实的"与"closure 口径是膨胀的"清晰分离** — §1.1 列 11 项 F+ 正面事实,§1.2 列 11 项 F- 负面事实,严格平衡;让实施者在收口时既不会因负面 finding 否定 RH0-RH2 的真实交付,也不能用正面事实掩盖 carry-over。

#### A.2.2 短板 / 盲区

1. **未捕捉 GPT R3 critical protocol drift** — Deepseek 在 R4 提到 "WS lifecycle 4 scenario 缺席",但没有反向 safeParse 检查 `attachment_superseded` 真实 payload 与 `SessionAttachmentSupersededBodySchema` 的字段差异。这是本轮唯一一个需要写代码而非改文档的 critical fix,deepseek 漏掉。GPT 用 zod schema reverse-check 抓到,deepseek 没有进入这个层次。
2. **R3 nano-session-do.ts 行数(1488 → 1594)在判定上偏严** — deepseek 把这升到 high / scope-drift,但实际上 RH1/RH2 新增的 `pushServerFrameToClient` (~50 行) + `onToolEvent` 注入 (~30 行) + `emitPermissionRequestAndAwait` (~20 行) 是 wire 工作不可避免的本地化,且功能边界清晰。本回应将其降级为"partially-fixed(口径修正)+ RH3 起严格执行新功能拆 seam 文件",而非"red-flag scope-drift"。reviewer 严判没毛病,但若 RH1/RH2 直接拒收等 RH6 megafile decomp,会拖延 device gate 落地。
3. **行文偏长(460 行,4 reviewer 中最长)** — F+/F- 各 11 项 + 10 finding + 跨阶段对齐表 + Out-of-Scope 9 项 + 收口意见;阅读成本高于其他 reviewer。在阶段评审时间敏感的场景下,reviewer 自己的 summary 容易被淹没。

### A.3 Findings 质量清点

| 问题编号 | 原始严重程度 | 事后判定 | Finding 质量 | 分析与说明 |
|----------|--------------|----------|--------------|------------|
| R1(Lane F wire-only)| critical | true-positive(blocker)| excellent | 与 GPT R2 / GLM R2 / kimi R6 cross-validation;deepseek 补充了 charter §10.3 第 1 条的引用,把它从"docs gap"提升为"NOT-成功退出条件"。修复:RH3 §2.1.1 C1 吸纳。|
| R2(context stub 不满足 charter 收口)| high | true-positive | excellent | 与 GLM R3 cross-validation,deepseek 加了对 4 家 api-gap-study P0 共识的引用,提高了优先级 framing。修复:RH2 closure §0 + Phase 3 verdict 改为 facade-live, inspector-stub。|
| R3(nano-session-do 1488 → 1594 违反 §5)| high | partial(true-positive but 严判)| good | 行数确实增长 + charter §5 / §5.1 原文确实有禁令;但增量代码本身无技术债,降到 medium 更合适。修复:口径修正 + RH3 起严格执行新功能拆 seam。|
| R4(WS lifecycle 4 scenario 缺席)| high | true-positive(blocker)| excellent | charter §7.3 P2-C 原文要求 + RH2 closure §3 已自承 deferred,deepseek 把"已自承"再次升级为"closure 不得宣称 WS NACP frame upgrade 完成"。修复:RH3 §2.1.1 C3 吸纳。|
| R5(check:cycles 软化)| medium | true-positive | good | 与 GPT R1 隐含 / GLM R8 / kimi R1 cross-validation。修复:口径同步 + RH6 cleanup carry-over。|
| R6(bootstrap-hardening 强度不足)| medium | true-positive | good | 与 GPT R2 隐含 / GLM R4 / kimi R2 cross-validation。修复:口径降级 + RH6 e2e harness。|
| R7(migration 008 未 apply)| medium | true-positive | good | 与 GPT R4 / GLM R6 cross-validation;deepseek 单独建议"超过 48 小时不 apply 应考虑 CI 自动化",这个 ops 视角是其他 reviewer 没有的。|
| R8(client adapter audit-only)| medium | true-positive | good | 与 GPT O1 (遵守) cross-validation,deepseek 严判 charter §7.3 交付物列表;但本环境无浏览器 audit-only 是合理的 environment-bound 决策。|
| R9(closure 口径断裂)| high | true-positive | **excellent** | 这是 deepseek 最有方法论价值的 finding — 其他 reviewer 散在多处提到"wire vs live 混淆",deepseek 提炼成系统性 docs-gap。修复:RH1/RH2 closure 文档状态 closed → close-with-known-issues + §0 重写。|
| R10(RH3 carry-over 累积瓶颈)| medium | true-positive | **excellent(missed-by-others)** | 唯一一个跳出 phase-internal 看下游的 reviewer。其他 3 reviewer 都没有给出 RH3 容量评估警告。修复:RH3 action-plan §2.1.1 显式吸纳 + 容量评估表 + 不可降级项标注(C1)。|

**总计**:10 个 finding,2 excellent + 5 good + 2 partial-but-good + 0 false-positive + 1 missed(GPT R3 协议漂移)。命中率 100%(无误报),excellence 率 30%。

### A.4 多维度评分(单向总分 10 分)

| 维度 | 评分 | 说明 |
|------|------|------|
| 证据链完整度 | 9 | F+/F- 11+11 三层证据(文件行号 / 测试运行 / charter 章节)都到位;唯一 partial 是未做 zod reverse-check |
| 判断严谨性 | 9 | 不被 closure 文档的乐观措辞误导,坚持 charter 原文为 truth |
| 修法建议可执行性 | 8 | R1/R2/R9 给出具体可粘贴的 closure §0 段落;R10 给出 RH3 capacity 评估;但部分修法 over-prescriptive(给 §0 完整段落而非 bullet 要点)|
| 对 action-plan / design / QNA 的忠实度 | 10 | 4 reviewer 中 charter 引用最精确,直接到 charter §10.3 第 1 条 / §5.1 等具体段落 |
| 协作友好度 | 7 | 行文偏长,核心结论在 §0 之外又重复出现在 §5;阅读成本高;但 verdict 修法明确,实施者执行无歧义 |
| 找到问题的覆盖面 | 9 | 10 项 finding 覆盖 RH0-RH2 + 跨阶段;唯一漏掉 R3 critical protocol drift |
| 严重级别 / verdict 校准 | 8 | R1/R4/R9 升 high/critical 校准准确;R3 把 nano-session-do 行数升到 high 偏严 |

**综合**:**8.5 / 10**

> Deepseek 最适合做"阶段闭合 truth-keeping 守门员":在 closure 即将归档时,用 charter-first + cross-phase 视角强制 reviewer-aware honesty;短板是协议层精确解码与篇幅控制。建议与 GPT(critical schema drift 捕捉)+ GLM(数值精度)+ Kimi(命令证据)组合使用,不单独依赖。
