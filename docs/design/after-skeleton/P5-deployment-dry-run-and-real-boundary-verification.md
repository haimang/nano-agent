# Nano-Agent Deployment Dry-Run and Real Boundary Verification 功能簇设计

> 功能簇: `Deployment Dry-Run and Real Boundary Verification`
> 讨论日期: `2026-04-17`
> 讨论者: `GPT-5.4`
> 关联调查报告:
> - `docs/plan-after-skeleton.md`
> - `docs/design/after-skeleton/P4-external-seam-closure.md`
> - `docs/design/after-skeleton/P3-session-edge-closure.md`
> - `docs/design/after-skeleton/P2-trace-first-observability-foundation.md`
> - `docs/eval/cross-packages-test-suite-01.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

在进入 Phase 5 之前，repo 已经拥有两种非常不同的“验证现实”：

- **代码层 reality**：`session-do-runtime` 已有 `worker.ts`、`routeRequest()`、`NanoSessionDO.fetch()`、`alarm()`、checkpoint/restore 等 deploy-oriented 骨架（`packages/session-do-runtime/src/worker.ts:15-71`, `routes.ts:15-75`, `do/nano-session-do.ts:128-308`）。
- **测试层 reality**：root `test/` 下已经有 contract tests 与 14 个 E2E 场景，并且有 `fake-llm / fake-session / fake-storage` 这套 fake-but-faithful harness（`package.json:1-10`; `test/e2e/e2e-01-full-turn.test.mjs:1-197`; `test/e2e/e2e-09-observability-pipeline.test.mjs:1-95`; `test/e2e/e2e-11-ws-replay-http-fallback.test.mjs:1-71`; `test/e2e/fixtures/*.mjs`）。

但与此同时，当前仓库距离真实 deployment 还差几个关键事实：

- `packages/session-do-runtime/wrangler.jsonc` 目前只声明了 `SESSION_DO` binding，没有 R2 / KV / fake worker / real provider 相关 binding（`packages/session-do-runtime/wrangler.jsonc:1-16`）。
- `WsController` 与 `HttpController` 仍然明显是 stub，说明“能 build / 能测”不等于“已经 deploy-shaped” （`packages/session-do-runtime/src/ws-controller.ts:1-56`, `http-controller.ts:1-102`）。
- Phase 4 才刚刚开始要求 external seam 进入真实 binding reality。

所以 Phase 5 的任务不是“上线生产”，而是：

> **建立一条从 in-process harness → wrangler dry-run → real boundary smoke 的验证阶梯，并定义清晰的收口标准。**

- **项目定位回顾**：nano-agent 不是本地 CLI；如果不经过 Worker/DO/WebSocket/service-binding/R2/KV 这些真实边界验证，很多“代码上看起来成立”的结论都不可信。
- **本次讨论的前置共识**：
  - 本阶段的目标是 **verification realism**，不是 full production launch。
  - dry-run 必须以真实 Wrangler / Worker / DO 形态为核心，而不是只重复 node 侧 E2E。
  - fake provider / fake capability / fake hook worker 仍是重要资产，因为它们可以先把 boundary 验真。
  - real smoke 只追求最小、可信、可重复，不追求 provider / browser / region 全矩阵。
  - Phase 5 是一个 **verification gate**，不是独立于 P3/P4 向前推进的实现流；若 session edge 或 external seam 尚未闭合，本阶段就没有值得验证的真实边界。
- **显式排除的讨论范围**：
  - 不讨论正式 CI/CD 流水线
  - 不讨论负载压测与容量规划
  - 不讨论多区域 / production canary rollout
  - 不讨论 billing / metering / ops dashboard

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Deployment Dry-Run and Real Boundary Verification`
- **一句话定义**：它负责建立 nano-agent 在 Worker/DO 真实宿主上的验证阶梯，明确哪些阶段用 fake-but-faithful external seams，哪些阶段必须接入真实 Cloudflare 边界与最小真实 provider smoke。
- **边界描述**：**包含** verification ladder、wrangler profiles、dry-run binding manifests、WebSocket/HTTP/DO smoke、real boundary smoke、release gate verdict；**不包含** full prod rollout、SLO/SLA、性能基线平台、正式 CI orchestration。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| **In-Process Harness** | 纯 Node test harness + fake delegates | 当前 `test/e2e` 已具备 |
| **Deploy-Shaped Dry-Run** | 真实 Wrangler + Worker + DO + bindings，但外部能力仍可用 fake worker | Phase 5 核心 |
| **Real Boundary Smoke** | 接入最小真实平台边界后的短链路验证 | 如真实 WebSocket + DO + R2/KV + 一条真实 provider smoke |
| **Verification Ladder** | 从低成本到高真实性的验证层级 | 不是一次跳到生产 |
| **Binding Manifest** | 某个验证 profile 真实启用的 wrangler bindings 列表 | local-dryrun / real-smoke |
| **Verdict Bundle** | 一次验证运行后留下的 trace / timeline / placement / summary 证据包 | 不是口头“感觉没问题” |

### 1.2 参考调查报告

- `docs/eval/cross-packages-test-suite-01.md` — 已经给出了 fake-but-faithful E2E harness 的方向与价值
- `context/codex/codex-rs/otel/src/trace_context.rs` — trace continuation 让 smoke 不只是“请求成功”，而是“链路可追踪”
- `context/claude-code/services/analytics/index.ts` — startup 期间先排队、后 attach sink 的策略说明部署验证必须覆盖早期事件不丢失（`80-164`）
- `context/claude-code/services/compact/compact.ts` — compact 与 reinjection 不是纯单测问题，必须进入真实 lifecycle 验证（`122-200`）
- `context/claude-code/utils/toolResultStorage.ts` — 大结果替换为引用是典型“本地看起来对，真实路径容易断”的边界（`130-199`）

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **从 skeleton 走向可信 runtime 的验证收口层**。
- 它服务于：
  1. `session-do-runtime`
  2. `external-seam-closure`
  3. `eval-observability`
  4. `storage-and-context-evidence-closure`
- 它依赖：
  - Worker entry / DO runtime / wrangler profile
  - external seams 的 fake worker closure
  - trace-first observability
  - 现有 contract + E2E harness
- 它被谁依赖：
  - 下一阶段真实功能扩展
  - 未来 DDL / API / frontend 适配判断
  - 项目阶段性收口 verdict

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| `Session Edge Closure` | Verification -> Session | 强 | WS upgrade、resume、ack、HTTP fallback 都是本阶段核心 smoke |
| `External Seam Closure` | Verification -> External | 强 | fake worker / service binding 必须走进真实 wrangler profile |
| `Trace-first Observability Foundation` | Verification -> Trace | 强 | 每次 dry-run / smoke 都要留下 trace verdict |
| `Eval-Observability` | 双向 | 强 | scenario runner、timeline、sink、inspector 是主要验证资产 |
| `Storage & Context Evidence Closure` | Verification -> Evidence | 强 | Phase 6 的 evidence 要建立在 Phase 5 的真实运行之上 |
| `LLM Wrapper` | Verification -> LLM | 中强 | local-fetch path 与 real provider smoke 都要在这里被验证 |
| `Capability Runtime` | Verification -> Capability | 中强 | fake capability worker 与 local-ts route 都要被验证 |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`Deployment Dry-Run and Real Boundary Verification` 是 **从 in-process skeleton 走向 Worker-native runtime 的验证阶梯设计**，负责 **把测试、Wrangler dry-run、真实平台边界 smoke 组织成一条可升级、可收口的验证链**，对上游提供 **可信的阶段性 verdict**，对下游要求 **不要再用“单测都绿了”替代真实边界验证**。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| 一上来就做 production rollout pipeline | 工程化自然冲动 | 当前更缺可信 smoke ladder，不缺发布按钮 | 可能 |
| provider / browser / hook / capability 全矩阵 real smoke | 测试覆盖冲动 | 首次验证应该最小可信，不应变成组合爆炸 | 可能 |
| 把 Node E2E 再包装一层当 dry-run | “省事”方案 | 这不会触达 Worker/DO/binding 真实边界 | 否 |
| full perf benchmark 与压测 | 运维导向 | 当前重点是 correctness，不是吞吐上限 | 可能 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| Verification profile | wrangler env / config profile | `local-dryrun`、`real-smoke` | staging / canary / perf |
| Scenario runner | `ScenarioRunner.run()` | test harness 驱动 | worker-attached smoke orchestrator |
| Verdict bundle | trace/timeline/placement/report files | 本地工件输出 | CI artifact / dashboard |
| Provider smoke matrix | small static list | 1 个真实 provider + 1 fake provider worker | 多 provider / region |

### 3.3 完全解耦点（哪里必须独立）

- **In-process harness 与 deploy-shaped dry-run**
  - **解耦原因**：前者验证包 contracts，后者验证 Cloudflare runtime boundary。
  - **依赖边界**：dry-run 可以复用 scenario spec，但不能复用“假装是 Worker”的执行环境。

- **Dry-run 与 real smoke**
  - **解耦原因**：fake workers 与真实 provider / R2 / KV 的风险面不同。
  - **依赖边界**：dry-run 通过后才进入 real smoke；real smoke 保持极小范围。

- **Verification verdict 与 business launch**
  - **解耦原因**：Phase 5 的结果是“边界成立/不成立”，不是“产品已可商用”。
  - **依赖边界**：通过 Phase 5 只意味着可以进入下一轮功能深化，不意味着直接上线。

### 3.4 聚合点（哪里要刻意收敛）

- **所有 deployment verification profiles 都收敛到统一 profile matrix**
- **所有 smoke 结果都收敛到 trace/timeline/placement 证据包**
- **所有 release gate 判定都进入统一 verdict 规则**
- **所有 Phase 5 的 fake workers 都复用 Phase 4 external seam contract**

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：主要是本地进程与本地工具环境，没有 Worker-native deployment verification 议题。
- **亮点**：
  - 小系统很容易手动 smoke
- **值得借鉴**：
  - golden path smoke 先从一条最小主链开始
- **不打算照抄的地方**：
  - 不以“手动跑通一次”代替 deploy-shaped verification

### 4.2 codex 的做法

- **实现概要**：更强调 rollout / trace / replay 与 session continuation，因此 smoke 的价值更接近“能不能完整追踪与恢复”。
- **亮点**：
  - trace continuation 与 replay 意识强
  - rollout JSONL 适合做 verdict evidence
- **值得借鉴**：
  - smoke 结果必须能被 replay / trace 证据支持
- **不打算照抄的地方**：
  - 不照抄其本地 runtime 与 Responses/API transport 复杂度

### 4.3 claude-code 的做法

- **实现概要**：真实产品化程度高，对 startup queue、analytics sink、tool result persistence、compact retry 都有 deploy-like thinking。
- **亮点**：
  - 早期事件不丢
  - 复杂 runtime 行为也有 telemetry 解释
- **值得借鉴**：
  - dry-run / smoke 必须覆盖 startup / attach / compact / large-result 这些“非 happy path”边界
- **不打算照抄的地方**：
  - 不复制其 Node/IDE/本地终端环境前提

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| deploy-shaped verification 意识 | 低 | 中高 | 高 | 高 |
| replay/trace 证据意识 | 低 | 高 | 中高 | 高 |
| startup / sink 过渡态处理 | 低 | 中 | 高 | 中高 |
| 对 Worker/DO/WebSocket 环境适配 | 低 | 低 | 低 | 高 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1] Verification ladder**
  - 必须明确 in-process harness、wrangler dry-run、real boundary smoke 三层关系与进入条件。

- **[S2] Dry-run binding profile**
  - 必须为 wrangler dev 建立 fake capability / hook / provider worker profile，而不是只保留 `SESSION_DO`。

- **[S3] Session-edge smoke**
  - 必须在真实 Worker/DO 边界上验证 WS start、ack/replay、resume、HTTP fallback、cancel、checkpoint/restore。

- **[S4] External seam smoke**
  - 必须在真实 binding 场景下验证 remote hook / remote capability / fake provider path。

- **[S5] Minimal real boundary smoke**
  - 必须至少验证一条真实 Cloudflare 存储边界（DO + R2/KV）与一条真实 provider smoke，不再全部停留在 fake harness。

- **[S6] Verdict bundle 与收口标准**
  - 每次验证必须产出可审阅证据，而不是“脚本退出码 0 就算完”。

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1] full production deploy pipeline**
- **[O2] load test / capacity test**
- **[O3] multi-provider / multi-region smoke matrix**
- **[O4] frontend end-user acceptance test**
- **[O5] CI orchestration / dashboard / release automation**

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| root `test/e2e` | in-scope，但不够 | 它是 Phase 5 的起点，不是终点 |
| `wrangler dev` + fake workers | in-scope | 这是 deploy-shaped dry-run 的核心形态 |
| 真实 provider 只测一条 golden path | in-scope | 先证明 boundary 可用，而不是做全矩阵 |
| 真实 browser-rendering smoke | out-of-scope | 当前还没进入最小主链 |
| session-do-runtime controller stub 清理 | in-scope 前置 | 若 controller 还是 stub，就没有 deploy-shaped dry-run 可言 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **verification ladder** 而不是 **“一次性接真环境”**
   - **为什么**：当前有大量高价值 fake harness 资产，也有明确的 runtime stubs；分层验证能最快定位哪一层断了。
   - **我们接受的代价**：Phase 5 不会马上产出“全面生产可用”的结论。
   - **未来重评条件**：当 Phase 5 通过后，再逐步扩大 real smoke 范围。

2. **取舍 2**：我们选择 **wrangler dry-run 作为主验证阶段** 而不是 **只靠 node E2E**
   - **为什么**：Worker/DO/WebSocket/service-binding 的核心价值都不在 node harness 内。
   - **我们接受的代价**：需要维护额外的 wrangler verification profile 与 fake workers。
   - **未来重评条件**：无；这是 Cloudflare-native 项目的必要成本。

3. **取舍 3**：我们选择 **最小真实 smoke** 而不是 **全矩阵真实集成**
   - **为什么**：真实边界的第一轮任务是证明关键路径成立，不是把验证规模做大。
   - **我们接受的代价**：短期不能覆盖所有 provider / binding 组合。
   - **未来重评条件**：当主链稳定后，再增加矩阵维度。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| dry-run 仍然太假 | 只换了命令入口，没换真实 bindings | 阶段性错觉 | 要求 Phase 5 必须使用 wrangler + real DO + real WS upgrade |
| real smoke 范围过大 | 一次接太多真实外部依赖 | 调试成本暴涨 | 固定单 golden path + 单 provider + 单 binding profile |
| verdict 只剩日志 grep | 没有统一证据包 | 收口不可审阅 | 强制输出 trace/timeline/placement/report 四件套 |
| startup / attach 边界事件丢失 | sink / worker 初始化顺序问题 | smoke 假通过 | 借鉴 claude-code 的 queued-events 模式，专门验证 early events |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：终于能区分“包 contract 成立”“Worker runtime 成立”“真实平台边界成立”这三种不同层级的完成度。
- **对 nano-agent 的长期演进**：为后续 frontend 接入、真实 skill worker、真实 provider 扩展提供可信基座。
- **对“上下文管理 / Skill / 稳定性”三大深耕方向的杠杆作用**：稳定性立刻提升；Skill 和上下文相关能力也能更早进入 deploy-shaped reality。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Verification Ladder | 定义三级验证阶梯与进入条件 | nano-agent 不再混淆 contract green 与 runtime green |
| F2 | Dry-Run Binding Profile | 建立 wrangler dry-run profile 与 fake worker 绑定 | 可以在真实 Worker/DO/binding 环境里跑最小主链 |
| F3 | Session Edge Smoke | 验证 WS/ack/replay/resume/fallback/checkpoint | session edge 不再只存在于设计稿和 node harness |
| F4 | External Seam Smoke | 验证 remote hook / capability / fake provider path | external seams 真能跨 worker 跑通 |
| F5 | Real Boundary Smoke + Verdict Bundle | 接入最小真实边界并产出证据包 | 阶段性收口可以被审阅，而不是靠主观判断 |

### 7.2 详细阐述

#### F1: `Verification Ladder`

- **输入**：现有 contract tests、E2E harness、session-do-runtime deploy skeleton
- **输出**：三层验证阶梯
- **主要调用者**：本阶段所有实施与 review
- **核心逻辑**：
  1. **L0 — In-process**：继续跑 root contract + E2E fake harness。
  2. **L1 — Deploy-shaped dry-run**：优先使用 `wrangler dev --remote`；若当前账号/环境不适合 remote dev，则改用 `wrangler deploy + workers.dev smoke`，但仍要求真 Worker/DO/WebSocket/service-binding 参与，外部 worker 可为 fake。
  3. **L2 — Real smoke**：在最小 golden path 中接入真实 R2/KV 与一个真实 provider smoke。
- **边界情况**：
  - 任何高层验证失败，都必须能回落到下一层定位，不允许直接“再试一次”。
- **一句话收口目标**：✅ **`每个验证失败都能被明确归类为 contract、deploy-shaped、或 real-boundary 断点`**

#### F2: `Dry-Run Binding Profile`

- **输入**：wrangler config、external seam binding catalog
- **输出**：一个 dry-run binding manifest
- **主要调用者**：`session-do-runtime`
- **核心逻辑**：
  1. 在当前 `SESSION_DO` 之外，为 dry-run profile 增加 fake capability worker、fake hook worker、fake provider worker、R2、KV 等 bindings。
  2. session runtime 根据 profile 选择 composition factory。
  3. 所有 fake workers 必须使用真实 transport / real binding，不允许重新回退成内存函数调用。
  4. dry-run profile 必须同时记录“走 remote dev 还是 deploy-smoke”的执行模式，避免把 wrangler 本地限制误读成 runtime bug。
- **边界情况**：
  - 当前仓库只有一个 `wrangler.jsonc` skeleton，Phase 5 必须承认并扩充这一现实，而不是假设已经有多 profile 基础设施。
- **一句话收口目标**：✅ **`wrangler dev 已能启动 deploy-shaped nano-agent，而不是只有单 DO skeleton`**

#### F3: `Session Edge Smoke`

- **输入**：`routeRequest()`、`NanoSessionDO.fetch()`、`ReplayBuffer`、checkpoint helpers
- **输出**：一组 session edge golden-path smokes
- **主要调用者**：Phase 5 verifier
- **核心逻辑**：至少覆盖：
  1. WebSocket upgrade 与 `session.start`
  2. `session.stream.ack` 与 replay/resume
  3. HTTP fallback `status/timeline`
  4. cancel mid-turn
  5. checkpoint / restore / alarm self-wake
- **边界情况**：
  - `WsController` / `HttpController` 当前仍是 stub，因此这些 smoke 在实现上也会倒逼 controller 真正接线。
- **一句话收口目标**：✅ **`session edge 的核心生命周期已在真实 Worker/DO 边界被证明成立`**

#### F4: `External Seam Smoke`

- **输入**：Phase 4 fake workers、service-binding transport
- **输出**：remote hook / capability / fake provider 的 smoke result
- **主要调用者**：Phase 5 verifier
- **核心逻辑**：
  1. remote capability：验证 request/progress/cancel/response
  2. remote hook：验证 `hook.emit / hook.outcome`
  3. fake provider：验证 request/stream/error path
  4. 全链路 trace/tenant propagation 必须可见
- **边界情况**：
  - 任何 remote seam 都不能因为 worker 不 ready 而 silently downgrade。
- **一句话收口目标**：✅ **`每条 external seam 都已从“设计接口”变成“真实可 smoke 的边界”`**

#### F5: `Real Boundary Smoke + Verdict Bundle`

- **输入**：真实 R2/KV、真实 provider secret、trace sink、timeline、placement log
- **输出**：最小真实边界 smoke 的证据包
- **主要调用者**：owner / reviewer / 下一阶段规划
- **核心逻辑**：
  1. 至少执行一条真实 golden path：client → WS → DO → LLM → stream → artifact/storage。
  2. 输出 trace timeline、placement evidence、session result summary、失败点位说明。
  3. L2 启动前必须先有一条明确 provider decision record；推荐沿用 `llm-wrapper` 的 OpenAI-compatible golden path，避免 fake provider 与 real provider 走两套 schema 世界。
  4. 给出明确 verdict：`green / yellow / red`，以及阻塞项。
- **边界情况**：
  - 真实 provider smoke 失败时，不应反向否定 dry-run 的结构价值；两者结论要分层表述。
- **一句话收口目标**：✅ **`阶段性收口不再靠口头判断，而是有可审阅的 boundary evidence bundle`**

### 7.3 非功能性要求

- **性能目标**：real smoke 只允许最小 golden path，不承担容量或压测职责。
- **可观测性要求**：每次 L1/L2 运行都必须产出完整 verdict bundle（trace/timeline/placement/summary），并记录使用的是 `remote-dev` 还是 `deploy-smoke` profile。
- **稳定性要求**：L1/L2 只有在 P3/P4 最小 closure 具备后才允许启动；否则必须回退到 lower rung，而不是继续追加 smoke case。
- **运行环境要求**：真实 provider secret 与 Wrangler 登录态可以先采用 owner-local/manual 注入，不把正式 CI secret orchestration 当作本 phase 前置条件。
- **Verdict 阈值**：
  - `green`：L0/L1 通过，L2 主 golden path 通过，verdict bundle 完整且无 blocking drift
  - `yellow`：L0/L1 通过，但 L2 仅部分通过，或存在明确可定位、未阻断主结构的边界缺口
  - `red`：L1 无法建立 deploy-shaped reality，或主 golden path 失败且 bundle/trace 不完整
- **测试覆盖要求**：至少需要 WS upgrade、resume/replay、HTTP fallback、remote capability/hook/provider、R2/KV placement、real-provider smoke 六类验证。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 nano-agent 当前代码

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `packages/session-do-runtime/wrangler.jsonc:1-16` | 当前只有 `SESSION_DO` binding | 说明 dry-run/profile 基础设施仍需补齐 | 是本 phase 的直接改造入口 |
| `packages/session-do-runtime/src/worker.ts:15-71` | deploy-oriented worker entry skeleton | Worker 宿主已具雏形 | 但不等于 dry-run 已闭合 |
| `packages/session-do-runtime/src/ws-controller.ts:1-56` | WebSocket controller stub | phase gate 必须诚实承认 controller reality | 这是 L1 前置缺口 |
| `packages/capability-runtime/src/targets/service-binding.ts:40-191` | remote capability transport seam | fake worker dry-run 可先复用这条 contract | 很适合 L1/L2 smoke |
| `packages/eval-observability/src/sinks/do-storage.ts:49-194` | durable trace sink | verdict bundle 的 trace/timeline 证据锚点 | 与 P6 强耦合 |

### 8.2 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/services/analytics/index.ts:80-164` | sink attach 前的 queued-events | startup / attach 期间的 early events 不能丢 | 很适合 smoke 期验证 |
| `context/claude-code/services/compact/compact.ts:122-200` | lifecycle-boundary verification thinking | 真实边界验证不应只停留在 happy path 单测 | 对 Phase 5 很有帮助 |

### 8.3 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/otel/src/trace_context.rs:19-88` | trace continuation discipline | real smoke 不只是“通了”，而是“trace 没断” | 适合作为 verdict bundle 基线 |

### 8.4 需要避开的“反例”位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `test/e2e/e2e-01-full-turn.test.mjs:1-197` | in-process happy path 绿色并不等于 Worker boundary 已成立 | L0 只能证明 contract/harness，不证明 deploy reality |
| `packages/session-do-runtime/src/http-controller.ts:1-102` | fallback 仍是 stub 时，L1/L2 结论会被高估 | 说明 verification gate 不能早于 runtime closure |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

`Deployment Dry-Run and Real Boundary Verification` 的职责，是把“代码里看起来已经差不多了”转换成“我们真的在 Worker/DO/WS/service-binding 边界上见过它工作”。它不是上线计划，而是一个带证据的 phase gate：L0 证明 contract，L1 证明 deploy-shaped reality，L2 证明最小真实边界。没有这道 gate，after-skeleton 的很多 closure 都会停留在 node-harness 幻觉里。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | Cloudflare-native runtime 没有真实边界验证就谈不上可信 |
| 第一版实现的性价比 | 4 | 需要额外 wrangler/binding/profile 工程，但收益极高 |
| 对未来“上下文管理 / Skill / 稳定性”演进的杠杆 | 4 | 所有后续扩张都会复用这条验证阶梯 |
| 对开发者自己的日用友好度 | 4 | 前期门槛更高，但能显著减少“假完成” |
| 风险可控程度 | 4 | 关键在于明确 phase gate 与 verdict 阈值，不把 smoke 做成黑盒 ritual |
| **综合价值** | **4** | **应作为 Phase 5 的正式 verification gate 保留，而不是独立于 P3/P4 的实现 phase** |

### 9.3 下一步行动

- [ ] **决策确认**：确认 Phase 5 的定位是 verification gate，且 L2 需要单独 provider decision record。
- [ ] **关联 Issue / PR**：补 dry-run binding manifest、wrangler profile、verdict bundle 输出与 green/yellow/red 判定实现。
- [ ] **待深入调查的子问题**：
  - [ ] owner 是否更偏好 `wrangler dev --remote` 还是 `deploy + workers.dev smoke` 作为默认 L1/L2 profile
  - [ ] real provider smoke 选择哪个 OpenAI-compatible provider/model 作为最小 golden path
- [ ] **需要更新的其他设计文档**：
  - `P4-external-seam-closure.md`
  - `P6-storage-and-context-evidence-closure.md`

---

## 附录

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.2 | `2026-04-18` | `GPT-5.4` | 补齐尾部章节；明确 verification gate、wrangler profile 分支、provider decision 与 verdict thresholds |
| v0.1 | `2026-04-17` | `GPT-5.4` | 初稿 |
