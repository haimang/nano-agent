# Nano-Agent 功能簇设计

> 功能簇: `HPX5 + HPX6 — Bridging the API Gap (前端可用性收口)`
> 讨论日期: `2026-05-02`
> 讨论者: `Owner + Opus 4.7 (1M)`
> 关联调查报告(本设计的 3 份输入):
> - `docs/eval/hero-to-pro/api-gap/claude-code-compared-by-opus.md` — 对照 Claude Code 主回路
> - `docs/eval/hero-to-pro/api-gap/codex-compared-by-GPT.md` — 对照 Codex item/event/runtime-config 模型
> - `docs/eval/hero-to-pro/api-gap/gemini-cli-compared-by-deepseek.md` — 对照 Gemini-CLI 12 类能力的形状/时序矩阵
> 关联基线文档:
> - `clients/api-docs/*.md` (HP9 frozen 18-doc pack)
> - `docs/design/hero-to-pro/HP5-confirmation-control-plane.md`
> - `docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md`
> - `docs/design/hero-to-pro/HPX-qna.md`
> - `README.md`(项目 vision)
> 关联 QNA / 决策登记:
> - `docs/design/hero-to-pro/HPX-qna.md`(已冻结的 Q1–Q27 仍然适用;HPX5/HPX6 新增 Q-bridging-1..8 在本文 §0.4 / §9.1 就地闭环)
> 关联评审报告(v0.2 修订基线):
> - `docs/eval/hero-to-pro/api-gap/HPX5-HPX6-design-docs-reviewed-by-deepseek.md` — 一手代码核查 3 处 nuance(emit 路径 / compactRequired 措辞 / F8 phase)
> - `docs/eval/hero-to-pro/api-gap/HPX5-HPX6-design-docs-reviewed-by-GPT.md` — `changes-requested`,5 项发现(R1 phase 边界 / R2 emit seam / R3 compact baseline / R4 truth owner / R5 protocol drift)
> - `docs/eval/hero-to-pro/api-gap/HPX5-HPX6-design-docs-reviewed-by-kimi.md` — 4 项最高优先级修正(F1 schema 路径 / F2 capability 链 / F6 D1 / F12 executor runtime)
> 文档状态: `draft v0.2 (review-revised, awaiting freeze)`

---

## 0. 背景与前置约束

### 0.1 三份调查报告的会聚共识

三位评审用了不同的对照系(Claude Code / Codex / Gemini-CLI),但**对核心断点的判断高度一致**:

| 缺口 | Opus 评级 | GPT 评级 | DeepSeek 评级 | 会聚结论 |
|---|---|---|---|---|
| `session.confirmation.request/.update` WS emitter 未 live | 🔴 阻断级 B1 | 🔴 P1 (Gap A) | 🔴 P0 (G1) | **必须 P0 修** |
| `WriteTodos` capability 缺失 + todo WS emitter 未 live | 🔴 阻断级 B2 | 🔴 P1 (Gap B) | (G7 P5) | **HPX5 接通 P0** |
| auto-compact 未接线 + compact body 字段被忽略 | 🔴 阻断级 B3 | ⚠️ P2 (Gap §3.2.5) | 🟡 P2 (G3) | **HPX5 接通 P0** |
| `model.fallback` WS emitter 未 live | 🟡 Y5 | (含在 Gap E) | 🟡 P3 (G4) | **HPX5 顺手接通** |
| Workspace temp file 字节读取 | 🟡 Y3 | 🔴 P1 (Gap C) | 🟢 P4 (G6) | **HPX5 接通 binary GET** |
| `tool-calls` 真实 ledger | 🟡 Y2 | (Gap §7.2 缺 tool execution 对象) | (G5 已闭环 via WS) | **HPX5 真实化 ledger** |
| `followup_input` WS client→server 帧 | (未列出,被 G2 主动放弃 trade-off 涵盖) | (Gap E runtime config) | 🔴 P1 (G2) | **HPX6 暴露** |
| Permission 规则面 / runtime config 面过薄 | 🟡 Y4 | 🟡 P3 (Gap E) | (未列) | **HPX6 收口** |
| `retry / fork / restore` 仍是 first-wave ack | 🟡 Y6 + Y1 | 🟡 P2 (Gap D) | 🟢 P5 (G7) | **HPX6 推到 completed** |
| 文档断点(枚举不一致 / shape 示例缺失) | D1–D7 | §6 共 6 处 | (未单列) | **HPX5 修文档断点** |
| Codex 风格 item 对象抽象 | (未列) | 🟡 P2 (Gap §7.2) | (未列) | **HPX6 设计 item-projection 层** |

### 0.2 HPX5 vs HPX6 的切分原则(v0.2 修订:边界更精确)

三份报告都做出相同的产品判断:

> **当前 API 已经够做"chat-first 前端 client",但还不够撑"完整 agent loop workbench"。**

v0.1 把这条分界写成"HPX5 不动 contract / HPX6 才动 contract" — 这个表述被三位评审一致指出过于乐观(GPT R1 / kimi §4.1)。一手代码核查后修订为:

- **HPX5 = "schema-frozen wire-up + bounded public surface completion"**
  - 主体仍是把已注册 schema 的 emitter / capability / runtime / 字节通道接通(F1 / F2 / F3 / F4 / F5 / F8)。
  - **接受的有限扩展**:`/start` 返回 `first_event_seq`(F7 内一个新字段)、F1/F2 emit seam 需要新建 `packages/nacp-session/src/emit-helpers.ts`(infra 文件,不动 contract)、F2 引入新 agent-core capability(WriteTodos)— 这些都是 implementation-level extensions,**non-breaking**,但不是零代码。
  - HPX5 的边界纪律:**不新增 D1 truth 表、不新增 public HTTP 路由(F5 例外:依赖已有 filesystem RPC,只是 façade pass-through)、不引入新 client→server WS 帧分支**。
- **HPX6 = "新 truth 表 + 新 public 路由 + 新 client→server 路径 + Codex 风格对象层"**
  - 新增 `nano_tool_call_ledger` 表(F6,从 v0.1 的 HPX5 移入)、`nano_session_runtime_config` 表(F9)。
  - 新增 `GET/PATCH /sessions/{id}/runtime`、`GET /items` 等公共路由。
  - 新增 client→server `session.followup_input` 在 public WS 的 accept handler — protocol shape 早已冻,但端到端 WS handler / actor-state 入队链路在 HPX6 才完整接通(GPT R5 修订)。
  - 引入 retry/fork/restore executor runtime(F11/F12/F13)。

**F8(followup_input)从 v0.1 的 HPX6 → 仍留 HPX6**:虽然 deepseek 建议提升到 HPX5(direction matrix + drainNextPendingInput 已就绪),但 GPT R5 + kimi §3.1 一手核查显示 `session-bridge.ts` 的 `SessionAction` 枚举不含 followup_input,NanoSessionDO 也无 WS handler,且 followup_input 与 retry / cancel 的 actor-state 交互需要在 HPX6 与 F11 / F9 一起统一建模。**取舍**:phase 不动,但承认 protocol 风险低,放在 HPX6 早期。

**F6(tool-calls 真实 ledger)从 v0.1 的 HPX5 → 移入 HPX6**:kimi §2.6 + GPT R1 一手核查确认 `nano_tool_call_ledger` D1 表不存在,需要新增 truth 表 + agent-core 在 tool execution 路径上的 D1 write hook。这超出 HPX5 "wire-up" 心智,且会影响 tool execution 性能,必须在 HPX6 与 F14(item projection)一起评估。HPX5 内 `/tool-calls` 仍返当前 first-wave shape,前端继续走 `/timeline` 拼。

### 0.3 显式排除的讨论范围

- **不重做 HP1–HP9 的任何已冻 contract**(NACP_VERSION = 1.1.0 仍是基线;Q1–Q27 仍然适用)。
- **不引入 sub-agent / sub-task 树式并行**(README §4.2 主动 trade-off 不变)。
- **不暴露 hooks 客户端注册面**(README §4.1 ③ 主动 trade-off 不变)。
- **不实现 memory 路由**(MEMORY.md / nested CLAUDE.md 注入留给 hero-to-platform)。
- **不做 Codex 完全照搬的 ThreadOptions / sandbox / network policy**(只在 HPX6 引入最小 runtime config object)。
- **不实现 LLM-side WriteTodos 之外的新 capability**(WriteTodos 是补已声明缺口,不算新设计)。

### 0.4 本设计必须回答的 owner-level 问题(v0.2 扩充)

- **Q-bridging-1**:HPX5 接通的 emitter / capability / runtime 是否需要新的 NACP version bump? **答**:否,保持 `NACP_VERSION = 1.1.0`。confirmation/todos/model.fallback/followup_input 的 body schema 与 message_type 在 `packages/nacp-session/src/{messages.ts,session-registry.ts,type-direction-matrix.ts,stream-event.ts}` 早已注册,HPX5 只是 emit seam 与 capability 接线。
- **Q-bridging-2**:HPX5 在前端 polling fallback 之上接通 WS emitter 后,polling 端点是否需要保留? **答**:保留。HTTP `/confirmations` `/todos` `/usage` 等路由是 truth 真相面,WS push 是事件通道;reconnect 窗口期 / HTTP-only 客户端 / reconcile 场景必须能查 truth。**v0.2 修正措辞**(GPT R5):前端 happy path 不依赖 polling;但**绝不**在文档里写"删除全部 polling 代码",因为 reconcile 场景永远存在。
- **Q-bridging-3**(v0.2 修正):`session.followup_input` 已冻 body shape **不止 `{text}`** — `messages.ts:119-126` 显示该 schema 含 `text(必填) + context_ref + stream_seq + model_id + reasoning + parts(1..32)`。HPX6 暴露到 public WS 时**保留完整 frozen shape**;首版前端 client MVP 仅依赖 `text`,advanced 字段对 SDK 集成方开放。**绝不**收窄已冻 shape。
- **Q-bridging-4**:HPX6 的 runtime config object 是 session-scoped 还是 turn-scoped? **答**:session-scoped(`PATCH /sessions/{id}/runtime`),per-turn override 仍走 `/input` body 的现有字段(model_id / reasoning),不双轨。
- **Q-bridging-5**:retry/fork/restore executor 是否需要新的 D1 表? **答**:否,executor 走已冻的 `nano_session_checkpoints` + `nano_checkpoint_restore_jobs` + `nano_session_fork_lineage`;HPX6 只是从 "open pending job" 推到 "drive job to terminal"。
- **Q-bridging-6**(v0.2 新增):`session.confirmation.request/.update` 与 `session.todos.write/.update` 帧是 **stream-event body** 还是 **独立顶层 WS frame**? **答**:**独立顶层 WS frame**。一手代码核查(`stream-event.ts:147-161` discriminated union 不含这 4 帧;`messages.ts:397-444` 的 `SESSION_BODY_SCHEMAS` 与 `session-registry.ts:23-69` 单独注册了它们的 message_type 与 direction)— 它们与 `session.heartbeat` 同层,**不**经过 `session.stream.event` 包装。HPX5 的 emit seam 必须支持 emit 非-stream-event 的顶层帧(当前 `pushStreamEvent` 只支持 stream-event 子类型)。
- **Q-bridging-7**(v0.2 新增,**v0.2.1 owner 决议:直接删,不留 dual-write**):新引入的 `runtime.permission_rules[]` 与已有的 `permission_mode` 4 档(`auto-allow/ask/deny/always_allow`)如何共存? **答**:**rule 优先级 > mode**;rule 命中即终态,rule 全部 miss 时落回 mode;HPX6 内**直接移除** legacy `POST /sessions/{id}/policy/permission_mode` 路由与 `nano_conversation_sessions.permission_mode` 字段;**不做 dual-write 兼容窗口**(owner 决议:hero-to-platform 不存在,所有迁移必须在 hero-to-pro 内闭环);客户端必须改用 `PATCH /sessions/{id}/runtime { approval_policy }`。
- **Q-bridging-8**(v0.2 新增):retry/fork/restore executor 在 Cloudflare Workers 上跑在哪种 runtime? **答**:**Queue consumer 主路径 + DO alarm 兜底监控**。理由:DO alarm 单次执行 30s 上限对 restore 大量 R2 复制不安全(kimi §3.3);Cloudflare Queues 提供至少一次投递 + 长 timeout + dead-letter,配合幂等 executor 实现 retry-safe;DO alarm 仅用于"job 卡住超过 5 分钟"的兜底重投。本决策影响 F11 / F12 / F13 共三项 executor 实现路径。

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**:`HPX5 + HPX6 — Bridging the API Gap`
- **一句话定义**:`把 HP9 frozen 18-doc pack 已经声明但未接通的 wire/capability/executor 全部补齐,让 nano-agent 从"chat 后端"升级到"WebSocket-first agent runtime",并提供前端 workbench 所需的 runtime config + item projection 层。`
- **边界描述**:这个功能簇**包含** confirmation/todos/model.fallback emitter 接线、WriteTodos capability、auto-compact wiring、workspace bytes GET、tool-calls 真实 ledger、文档断点修复、followup_input client 帧、retry/fork/restore executor、runtime config object、item projection 层。**不包含** 新协议设计、subagent 树、hooks 客户端注册、memory 路由。
- **关键术语对齐**(必填):

| 术语 | 定义 | 备注 |
|------|------|------|
| **wire-up** | schema 已冻、emitter / handler 接到真实 runtime 上 | HPX5 主体动作 |
| **emitter** | 在 orchestrator runtime 真实 emit 一个已注册 schema 的 WS 帧 | 不动 schema |
| **capability** | agent-core kernel 中 LLM 可调用的内部能力 | 如 `WriteTodos` |
| **wiring gap** | schema 已冻但 emitter / capability 未接 | HPX5 收口对象 |
| **executor** | 把 first-wave "open pending job" 推到 terminal 的后台执行器 | HPX6 主体动作 |
| **followup_input** | 用户在 turn 进行中通过 WS push 一条新指令 | 复用 nacp-session minimum surface |
| **runtime config object** | session-scoped 的 runtime knobs(permission rules / network / search / workspace scope) | HPX6 新增 |
| **item projection** | 在现有 stream-event 之上抽出的 Codex 风格 item 对象视图 | HPX6 新增的 read-time projection |
| **shape correctness** | request/response/帧的字段形状是否冻结 | nano-agent 已成熟 |
| **temporal completeness** | runtime 是否在正确时机真实 emit / drive | HPX5/HPX6 主攻方向 |

### 1.2 参考调查报告

- `docs/eval/hero-to-pro/api-gap/claude-code-compared-by-opus.md` §4(B/Y/G/D 四档断点)、§6(P0–P3 补丁集)
- `docs/eval/hero-to-pro/api-gap/codex-compared-by-GPT.md` §5(Gap A–E)、§7(对象模型缺口)、§9(P0–P3 建议)
- `docs/eval/hero-to-pro/api-gap/gemini-cli-compared-by-deepseek.md` §4(G1–G7 缺口总汇)、§5(形状正确性 vs 时序完整性)、§6(P0–P5 建议)

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- **角色**:这个功能簇是 hero-to-pro 阶段的**最后一公里收口** — 把 HP1–HP9 已经冻好的 schema/contract 真正驱动起来,让前端从"读文档+轮询" UX 升级到"事件驱动+对象演进" UX。
- **服务对象**:前端 client(web、wechat-miniprogram、未来 IDE-style workbench)、SDK 集成方、内部 e2e 测试。
- **依赖**:
  - 已冻的 NACP_VERSION = 1.1.0 contract
  - HP5 confirmation control plane(已 live HTTP plane)
  - HP6 tool/workspace state machine(已 live D1 truth + RPC leaf)
  - HP7 checkpoint substrate(snapshot lineage + restore job D1 表)
  - HP9 docs pack(本设计修文档断点也写回这一层)
- **被依赖**:
  - 前端 client 一切实时 UX
  - hero-to-platform 阶段的 sub-agent / multi-tenant 扩展(需要 workbench 级 runtime config 作为前置)

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|------------|----------|----------|------|
| HP5 confirmation plane | HPX5 → HP5 | 强 | HPX5 在 confirmation row 写入后 emit `session.confirmation.request/.update` |
| HP6 todo/workspace plane | HPX5 → HP6 | 强 | HPX5 接 WriteTodos capability + 暴露 workspace bytes GET + 真实化 tool-calls ledger |
| HP3 context plane | HPX5 → HP3 | 强 | HPX5 解除 `compactRequired:false` 硬编码,让 runtime 真触发 compact |
| HP2 model plane | HPX5 → HP2 | 中 | HPX5 接 `model.fallback` emitter |
| HP7 checkpoint plane | HPX6 → HP7 | 强 | HPX6 把 restore/fork executor 从 pending 推到 terminal |
| nacp-session protocol | HPX6 → nacp-session | 中 | HPX6 把已冻的 `session.followup_input` 提升到 public WS direction matrix |
| 18-doc pack | HPX5 / HPX6 → docs | 强 | 文档断点修复(D1–D7)+ 新章节(runtime config / item projection) |
| 客户端 SDK / 测试 | HPX5 / HPX6 → 测试 | 强 | e2e 测试覆盖每条 emitter 与 executor 终态 |

### 2.3 一句话定位陈述

> "在 nano-agent 里,**HPX5+HPX6** 是 **hero-to-pro 的收口阶段**,负责 **把已冻 schema 与 contract 转化为真实 runtime 行为**,对上游(前端 client)提供 **事件驱动的 agent loop + workbench 级控制面**,对下游(orchestrator-core / agent-core / context-core / filesystem-core)要求 **emitter 接线 + executor 接线 + runtime config 接线,但不引入新的 contract 形状**。"

---

## 3. 架构稳定性与未来扩展策略

### 3.1 精简点(哪里可以砍)

| 被砍项 | 参考来源 / 诱因 | 砍的理由 | 未来是否可能回补 / 重评条件 |
|--------|------------------|----------|-----------------------------|
| 客户端 confirmation HTTP polling fallback 代码 | 三份报告共识缓解方案 | HPX5 接通 emitter 后客户端可改事件驱动 | 不重评;polling 路由保留作为 reconcile,客户端代码可选择是否启用 |
| `legacy session.permission.request` / `session.elicitation.request` 帧的兼容讨论 | permissions.md §1 | HP5 已声明不再 emit;客户端**只走** confirmation.request | 永不 |
| 60s preview cache(Q12 未实现项) | context.md §5 | 三份报告都没有把它列为前端阻断 | 留作 hero-to-platform 性能优化 |
| 主动设计 sub-agent / sub-task 树面 | README §4.2 | 主动 trade-off 不变 | hero-to-platform 阶段重评 |
| Memory 路由 / MEMORY.md 注入 | Opus G3 | 不在 hero-to-pro vision 内 | hero-to-platform |

### 3.2 接口保留点(哪里要留扩展空间)

| 扩展点 | 表现形式 | HPX5 / HPX6 第一版行为 | 未来可能的演进方向 |
|--------|----------|------------------------|---------------------|
| **emit seam helper(v0.2 新增)** | 新建 `packages/nacp-session/src/emit-helpers.ts` + 扩展 `runtime-assembly.ts` 的 `pushStreamEvent` deps,新增 `emitTopLevelFrame(message_type, body)` | 第一版只供 F1/F2/F4 使用;现有 stream-event emitter(turn.begin/end / tool.call.* / llm.delta / system.notify)**不强制迁移** | 未来 hero-to-platform 阶段把所有 emit 收敛到此出口 |
| **runtime config object** | `GET/PATCH /sessions/{id}/runtime` + `RuntimeConfigSchema` + 新建 D1 表 `nano_session_runtime_config` | 第一版字段集:`permission_rules[]`(per-tool allow/deny/ask)、`network_policy: {mode}`、`web_search: {mode}`、`workspace_scope: {mounts[]}`、`approval_policy`(legacy `permission_mode` 的现代替代) | 未来可加 sandbox / additional_directories / search depth 等 Codex ThreadOptions 字段 |
| **`session.followup_input` WS frame** | client→server WS frame,在 `attached / turn_running` phase 接受;走 `nacp-session` 已冻完整 shape | **frozen shape 完整暴露**(text 必填 + context_ref + stream_seq + model_id + reasoning + parts);**首版前端 MVP 只依赖 text**,advanced 字段对 SDK 集成方开放 | 未来扩展 replace-prompt / merge 语义(post-Phase-0) |
| **item projection layer** | `GET /sessions/{id}/items?cursor=` + `session.item.{started,updated,completed}` WS frames | 第一版 item kinds:`agent_message / reasoning / tool_call / file_change / todo_list / confirmation / error`(7 类);所有 item 来自 read-time projection,**不引入新 truth** | 未来扩展 `web_search / mcp_tool_call / patch_diff` 等 |
| **tool-calls ledger 真实化** | 新增 D1 `nano_tool_call_ledger` + `GET /tool-calls` 真实读 + `GET /tool-calls/{request_uuid}` detail | 第一版含 `tool_name / input(redacted) / output(可能 R2 spill) / status / started_at / ended_at / cancel_initiator?` | 未来加 timing breakdown / tool capability version |
| **workspace bytes GET** | `GET /sessions/{id}/workspace/files/{*path}/content` binary profile,**复用** filesystem-core 已 live `readTempFile` RPC | 第一版只读 + size cap 25 MiB;写仍走 LLM-driven workspace metadata PUT(filesystem-core 已实现) | 未来加 partial range / streaming download |
| **WriteTodos capability** | agent-core internal capability,触达 `D1TodoControlPlane`(已 live);**含 tool schema 注册 + execution 路由 + 自动 close 上一个 in_progress** | 第一版 LLM 可写 content / status / parent_todo_uuid;V2 task graph 子树留 hero-to-platform | Q20 已冻 5-status flat list,O15 hero-to-platform 重评 |
| **restore / fork / retry executor** | Cloudflare Queue consumer 主路径 + DO alarm 兜底监控(Q-bridging-8) | 单次 job 至少一次投递;幂等 executor;失败 dead-letter 后写 `failure_reason / rolled_back` | 未来引入跨-worker scheduler 或 Workers Workflow |

### 3.3 完全解耦点(哪里必须独立)

- **解耦对象**:**item projection 层** ↔ **stream event 层**
- **解耦原因**:item projection 是 read-time 投影,**绝不**替代 stream event 作为 source of truth。stream event 是 WS 主流(append-only),item 是从 stream event + D1 truth 投影出来的对象视图。
- **依赖边界**:item projection 可以读 stream event ledger 和 D1 row,但不能写;item 的 created_at / updated_at 来自 source row,不引入新的 mutable state。

### 3.4 聚合点(哪里要刻意收敛)— v0.2 修订

- **聚合对象**:**HPX5/HPX6 新增的所有 emitter**(F1/F2/F4)必须收敛到**新建**的 `packages/nacp-session/src/emit-helpers.ts` 单一出口。
- **关键事实**(v0.2 修正,deepseek + GPT 一手核查):
  - 该文件**当前不存在**,需要在 HPX5 第一周作为 infrastructure 任务先建出来。
  - 当前 emit 经 `agent-core` 的 `pushStreamEvent(kind, body)` deps(只支持 `session.stream.event` 子类型)+ User DO 的 `emitServerFrame`(支持顶层帧但分散在多处)。
  - F1/F2 的 confirmation/todos 帧是**独立顶层帧**(Q-bridging-6),`pushStreamEvent` 不能直接复用;需要在 `runtime-assembly.ts` 的 deps 中新增 `emitTopLevelFrame(message_type, body)` callback。
- **聚合形式**:
  - emit 之前必须经对应 body schema(`SESSION_BODY_SCHEMAS[message_type]`)zod 校验;
  - 校验失败必须 fall back 到 `system.error` 通道(stream-event family),**绝不**静默丢帧;
  - emit latency 写入 `nano_emit_latency_ms` metric。
- **现有 emitter 的迁移策略**:
  - **不强制迁移** turn.begin / turn.end / tool.call.* / llm.delta / system.notify 等已 live 的 stream-event 路径(避免 HPX5 引入大重构风险)。
  - 新建 helper 仅作为 F1/F2/F4 的强制出口;hero-to-platform 阶段再做全量收敛。
- **为什么必须新建而非沿用**:三份报告(尤其 GPT R2)都明确 nano-agent 当前缺的不是"几个 emit call",而是一条**跨 worker 的 event bridge** — confirmation row 写在 orchestrator-core,emit 必须穿过 service binding 进入 agent-core / User DO 的 WS 出口;helper 必须封装这条跨 worker 通道,否则每个 caller 都重复造轮子。

---

## 4. 参考实现 / 历史 precedent 对比

> 本节直接吸收三份调查报告的对照结论,不重复 investigation 全文。

### 4.1 mini-agent 的做法

不在本次对照范围内;HPX5/HPX6 不参考 mini-agent。

### 4.2 codex 的做法

- **实现概要**(GPT 报告 §2.2):Codex 暴露 `thread.started / turn.started/completed/failed / item.started/updated/completed`,item 包含 `agent_message / reasoning / command_execution / file_change / mcp_tool_call / web_search / todo_list / error`;`ThreadOptions` 暴露 approvalPolicy / sandboxMode / workingDirectory / networkAccessEnabled / webSearchMode 等。
- **亮点**:item 抽象让前端能消费"对象级演进"而不是只消费零散 stream;runtime config 让用户能控制 agent 怎么运行。
- **值得借鉴**:
  - HPX6 的 item projection 层直接吸收 Codex item 分类(`agent_message / reasoning / tool_call / file_change / todo_list / confirmation / error`)。
  - HPX6 的 runtime config object 吸收 Codex ThreadOptions 的"显式 runtime knobs"心智。
- **不打算照抄的地方**:
  - 不照搬 sandboxMode / workingDirectory(nano-agent 是 V8 isolate,没有 OS sandbox)。
  - 不照搬 additionalDirectories(workspace_scope 已经覆盖,且更符合 R2 mount 心智)。
  - 不引入完整 Codex ThreadOptions 的所有字段,只取"前端 workbench 必需"的最小集。

### 4.3 claude-code 的做法

- **实现概要**(Opus 报告 §1):`query.ts` 单回合自递归循环;canUseTool 阻塞 ask;auto-compact + reactive-compact + microcompact + collapse 四级降阶;stop-hook 有死循环防护。
- **亮点**:HITL 是同步阻塞点而非 fire-and-forget;auto-compact 是 runtime 自动行为而非客户端责任;tool execution 有 streaming executor 让工具开始执行时 LLM 仍在 stream。
- **值得借鉴**:
  - HPX5 接通 confirmation emitter 后,语义对齐 Claude Code 的"阻塞 ask";前端 UX 与 Claude Code 一致。
  - HPX5 接通 auto-compact runtime 后,语义对齐"runtime 主动管理 context",而非把 context management 推给客户端。
  - HPX6 的 retry executor 不抄 Claude Code 的 streaming executor 复杂度,但要在概念上对齐"retry 是真实新 attempt,而非提示客户端重发"。
- **不打算照抄的地方**:
  - 不照搬 stop-hook(README 主动 trade-off 不暴露 hooks)。
  - 不照搬 reactive-compact 的复杂度(nano-agent 的 compact 由 context-core 集中负责,不在 query loop 里递归)。
  - 不照搬 fork subagent 的递归 query()(单 agent / 单线程 trade-off 不变)。

### 4.4 gemini-cli 的做法

- **实现概要**(DeepSeek 报告 §1):12 类能力矩阵;confirmation 是 MessageBus 事件;Scheduler 阻塞等待 TOOL_CONFIRMATION_RESPONSE;ChatCompressionService 阈值触发自动压缩。
- **亮点**:confirmation 走 MessageBus 形成实时闭环;ChatCompressionService 接到 runtime 而不是 advisory probe。
- **值得借鉴**:
  - HPX5 confirmation emitter 接线方式可以直接对齐"runtime row-write 之后 emit"(已和 HP5 row-first dual-write law Q16 对齐)。
  - HPX5 auto-compact 接线方式可以对齐"阈值触发 + WS notify"(已和 HP3 `compact.notify` schema 对齐)。
- **不打算照抄的地方**:
  - 不引入 MessageBus(nano-agent 用 WS frame + service binding RPC 已经够)。

### 4.5 横向对比速查表

| 维度 | claude-code | codex | gemini-cli | nano-agent 倾向(HPX5/HPX6 后) |
|------|-------------|-------|------------|-----------------------------|
| Confirmation 实时性 | sync block via canUseTool | sync via Item event | sync via MessageBus | **HPX5: WS push + HTTP fallback** |
| Item 对象抽象 | Message[] flat | Item 一等对象 | Stream events | **HPX6: read-time projection over events + D1** |
| Runtime config | ToolPermissionContext + permission rules + permission mode 6 档 | ThreadOptions(8 字段) | (隐式) | **HPX6: 最小 5 字段 RuntimeConfig** |
| Auto-compact | 4 级 compact 流水线 | (隐式 server-side) | ChatCompressionService 阈值触发 | **HPX5: 接通阈值触发 + 保留手动 trigger** |
| Followup input mid-turn | submit-while-running 队列 | (无) | 取消重发 | **HPX6: WS client→server frame** |
| Retry / fork / restore | retry 重发 / Fork subagent | (无 fork concept) | (无) | **HPX6: 真实 executor 推到 terminal** |
| Tool ledger | transcript 持久 | item.tool_call | scheduler.activeCalls | **HPX5: 真实 D1 ledger + GET detail** |
| Workspace bytes 可读 | 真实文件系统 | sandbox FS | sandbox FS | **HPX5: binary GET + 25 MiB cap** |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope(本设计确认要支持)— v0.2 phase 重排

> **v0.2 phase 重排说明**:
> - F6 (tool-calls 真实化 ledger) 从 HPX5 移入 HPX6 — 一手核查确认 `nano_tool_call_ledger` D1 表不存在,需新增 truth 表 + agent-core 写入 hook,超出 HPX5 wire-up 心智。
> - F8 (followup_input) 仍留 HPX6 — protocol shape 已冻、queue 已实现,但 SessionAction 枚举不含、NanoSessionDO 无 WS handler、且与 F11(retry)的 actor-state 交互需统一建模。
> - F0 (新增) **emit-helpers infrastructure** — HPX5 第一周必须先建出来,作为 F1/F2/F4 的强制出口。

#### HPX5 — Wire-up Phase(已 schema-frozen 能力的 emitter / capability / runtime 接线 + bounded surface completion)

- **[S0]**(v0.2 新增)**新建 `packages/nacp-session/src/emit-helpers.ts` + 在 `runtime-assembly.ts` 注入 `emitTopLevelFrame` deps**:为 F1/F2/F4 提供统一 emit 出口;封装 cross-worker event bridge(orchestrator-core row write → agent-core / User DO WS push)。**这是 HPX5 的 infrastructure 前置,必须在 W1 完成。**
- **[S1]** **接通 `session.confirmation.request` 与 `session.confirmation.update` 的 WS emitter**(走**独立顶层帧**,Q-bridging-6;**不**扩展 `SessionStreamEventBodySchema`)— 三份报告会聚 P0 共识,HITL 实时性的主断点。
- **[S2]** **接通 agent-core `WriteTodos` capability + `session.todos.write/.update` WS emitter**:
  - **S2a**:在 agent-core kernel 的 capability registry 注册 WriteTodos tool schema(LLM 可见)
  - **S2b**:tool execution 路由把 `WriteTodos(content, status?, parent_todo_uuid?)` 调到 `D1TodoControlPlane`(已 live);自动 close 上一个 in_progress 避免 Q19 invariant
  - **S2c**:row write 之后 emit 顶层帧(走 S0 的 emit-helpers)
- **[S3]** **接通 auto-compact runtime trigger + façade body 透传**(v0.2 修订措辞):
  - 在 `workers/agent-core/src/host/runtime-mainline.ts` 注入 `composeCompactSignalProbe(budgetSource, breaker)` 到 `OrchestrationDeps.probeCompactRequired`(`compact-breaker.ts` 已实现 3 次熔断,无需重做)
  - `budgetSource` 接 context-core token 探针
  - 触发**仅在 turn 边界**(turn.end 之后,turn.begin 之前),绝不中断 stream
  - façade 层 `/context/compact/preview` 与 `/context/compact` 真实读 body 字段(`force / preview_uuid / label`)并透传到 context-core RPC
  - 完整 4 状态 `compact.notify` 链路 emit(started → completed/failed/skipped)
- **[S4]** **接通 `model.fallback` WS emitter**(field 名以 schema 为准:`turn_uuid / requested_model_id / fallback_model_id / fallback_reason`)— fallback 不再静默,前端能即时更新 model badge。
- **[S5]** **暴露 workspace temp file 字节读取**(`GET /sessions/{id}/workspace/files/{*path}/content`,binary-content profile,25 MiB cap)— **复用** filesystem-core 已 live `readTempFile` RPC(`workers/filesystem-core/src/index.ts:160-175`),仅 façade pass-through。
- **[S7]** **修文档断点 D1–D7 + GPT §6.1–6.6**:
  - D1 envelope dual-shape unwrap helper 文档化
  - D2 close/delete/title legacy body-level error 映射写进 error-index.md
  - D3 dual-emit 1s dedup 写进 client cookbook 章节
  - D4 start→ws attach 之间的帧保留窗口契约写进 session-ws-v1.md(`/start` 返回 `first_event_seq`)
  - D5 60s preview cache 标 not-implemented 不变,但 UI 不依赖结果稳定要写进 context.md
  - D6 `409 confirmation-already-resolved` 视作终态成功的 client cookbook 条目
  - D7 artifact / workspace temp / snapshot 三概念区分图写进 workspace.md
  - GPT §6.1–6.6 的 6 处不一致全部修齐(`/context` 语义、`/start` pre-mint 一致性、confirmation kind 统一为 `tool_permission`、decision body 统一为 `status + decision_payload`(legacy `decision/payload` 在 façade 层 dual-accept 1 个版本)、`session_status` 7 值枚举写进 transport-profiles.md、history/timeline 补完整 schema 示例)
  - **v0.2 新增**:更新 18-doc pack 中所有 implementation reference 行号到新的模块化 `workers/orchestrator-core/src/{facade,hp-absorbed-routes,*-control-plane}.ts` 结构(deepseek §1.4)

#### HPX6 — Workbench Phase(从 first-wave ack 推到 completed surface + 新 truth 表 + Codex 风格对象层)

- **[S6]**(v0.2 移入 HPX6)**`/sessions/{id}/tool-calls` 真实化 ledger**:
  - 新增 D1 表 `nano_tool_call_ledger`(migration)
  - 在 agent-core tool execution 路径上 fire-and-forget 写入 D1(避免阻塞 stream)
  - `GET /tool-calls` 真实读 D1;新增 `GET /tool-calls/{request_uuid}` detail
  - input/output 走 `applyToolResultBudget` 同款规则,过大 R2 spill + 返预览 + `output_r2_key`
- **[S8]** **暴露 `session.followup_input` 为 public WS client→server frame**(v0.2 修订):
  - **保留 nacp-session 已冻完整 shape**(text + context_ref + stream_seq + model_id + reasoning + parts);**绝不**收窄到 `{text}`(Q-bridging-3)
  - 在 `session-bridge.ts` 的 `SessionAction` 加 `followup_input`;NanoSessionDO 新增 WS handler;入队 `actorState.pendingInputs`
  - 与 F11(retry)、`POST /cancel` 的 actor-state 交互在 HPX6 设计早期统一建模
  - **首版前端 MVP 仅依赖 text**;advanced 字段对 SDK 集成方开放
- **[S9]** **新增 `GET/PATCH /sessions/{id}/runtime` 与 `RuntimeConfigSchema`**:
  - 新建 D1 表 `nano_session_runtime_config`(migration)
  - 字段集:`permission_rules[]`、`network_policy: {mode}`、`web_search: {mode}`、`workspace_scope: {mounts[]}`、`approval_policy`(legacy `permission_mode` 的现代替代)
  - PATCH 触发 `session.runtime.update` WS 帧(走 S0 emit-helpers)
- **[S10]** **Per-tool / per-pattern 持久化 permission rules + 与 `permission_mode` 共存策略**(Q-bridging-7):
  - `runtime.permission_rules: [{tool_name, pattern?(glob), behavior: allow|deny|ask, scope: session|tenant}]`
  - rule 优先级 > mode;rule 全 miss 时 fall back 到 mode
  - 新建 D1 表 `nano_team_permission_rules`(scope=tenant 用)
  - `POST /policy/permission_mode` 在 hero-to-pro 阶段 dual-write 到 runtime config 的 `approval_policy` 字段
  - 文档明确 `permission_mode` 标 deprecated;hero-to-platform 移除 legacy 路由
- **[S11]** **真实化 retry executor**:`POST /sessions/{id}/retry` 真正创建 attempt-chain(`nano_conversation_turns.requested_attempt_seed`,`turn_attempt += 1`),原 turn 标 `superseded_by_turn_attempt`。executor 走 **Cloudflare Queue consumer**(Q-bridging-8)。
- **[S12]** **真实化 restore executor**:走 Queue consumer + DO alarm 兜底;driving `nano_checkpoint_restore_jobs.status` from `pending → running → succeeded|partial|failed|rolled_back`,带 `failure_reason`(Q24);emit `session.restore.completed` 顶层帧(新 message_type,需 nacp-session schema 扩展 — 这是 HPX6 contract 扩展)。
- **[S13]** **真实化 fork executor**:走 Queue consumer + DO alarm 兜底;driving `nano_session_fork_lineage` 完整建立,emit `session.fork.created` 真实帧(schema 已冻,但当前未 emit)。
- **[S14]** **新增 item projection 层**:
  - **Source-of-Truth matrix**(v0.2 新增,见 §附录 C):每类 item 从哪个 D1 表 / stream event 投影
  - `GET /sessions/{id}/items?cursor=` 列表
  - `GET /sessions/{id}/items/{item_uuid}` 详情
  - WS `session.item.{started,updated,completed}` 帧族(direction = server-only;新 message_type,nacp-session schema 扩展)
  - item kinds:`agent_message / reasoning / tool_call / file_change / todo_list / confirmation / error`(7 类)
  - 实现是 read-time projection,**不引入新 truth 表**
- **[S15]** **新增 `file_change` 事件 + 对象** — workspace bytes GET 之上,在 LLM 通过 filesystem-core writeTempFile/deleteTempFile 完成时 emit `file_change` item(含 path / change_kind: created|modified|deleted / size_delta / content_hash);前端 IDE-style diff viewer 的基础;依赖 S5 + S14。

### 5.2 Out-of-Scope(本设计确认不做)

- **[O1]** **WriteTodos V2 task graph(子 todo 树)** — Q20 frozen 5-status flat list 不变,O15 hero-to-platform 重评。
- **[O2]** **完整 Codex ThreadOptions 的全部字段** — 只取 5 字段最小集(permission_rules / network / web_search / workspace_scope / approval);sandbox / additional_directories 等留作未来扩展点。
- **[O3]** **MCP tool 调用 item kind** — `mcp_tool_call` 不在第一版 item kinds 内,统一走 `tool_call`;HPX-Q post-pro 重评。
- **[O4]** **跨 conversation fork** — Q23 fork = same conversation only 不变。
- **[O5]** **跨 turn fallback chain** — Q8 single-step fallback 不变。
- **[O6]** **Subagent / sub-task 树面** — README §4.2 主动 trade-off。
- **[O7]** **Hooks 客户端注册面** — README §4.1 ③ trade-off。
- **[O8]** **Memory 路由** — hero-to-platform。
- **[O9]** **`session.thought` / reasoning 独立 stream frame** — DeepSeek §2.2 自评低优先级;reasoning 走 item projection 层就够。
- **[O10]** **streaming tool execution(LLM 还在 stream 时工具就开始跑)** — Claude Code 的 StreamingToolExecutor,nano-agent 第一版不引入,留作 hero-to-platform 性能优化。

### 5.3 边界清单(容易混淆的灰色地带)

| 项目 | 判定 | 理由 | 后续落点 |
|------|------|------|----------|
| `runtime.permission_rules` 是否可被 LLM 修改 | **out-of-scope** | LLM 不能升权;runtime config 只能由 user(authenticated)修改 | HPX6 设计冻结 |
| `followup_input` 是否支持 image/artifact_ref | **out-of-scope** | 第一版只支持 `{text}` minimum surface | HPX6 后续批次或 hero-to-platform |
| item projection 是否在 reconnect 时一并重放 | **in-scope** | `last_seen_seq` 同时覆盖 stream event 与 item frame | HPX6 §S14 实现 |
| auto-compact 触发后是否自动 emit `compact.notify` | **in-scope** | HP3 `compact.notify` 已在 schema 内,HPX5 接通后必然 emit | HPX5 §S3 |
| restore executor 是否需要 confirmation gate | **in-scope** | Q22 + HP5 已要求 `confirmation_uuid`,executor 不能绕过 | HPX6 §S12 |
| tool-calls detail 是否包含工具内部 stack trace | **out-of-scope** | 安全/隐私原因,只暴露 status / error_message | HPX5 §S6 |
| `runtime.workspace_scope` 是否暴露 R2 key 直读 | **out-of-scope** | tenant boundary 不能被客户端绕过 | 永远不 |
| document 断点修复是否引入 contract 变更 | **不引入** | 只补 helper / 错误码映射 / 缺失 schema 示例,formats 不变 | HPX5 §S7 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**:我们选择 **"两阶段切分(HPX5 wire-up + HPX6 workbench)"** 而不是 **"一阶段 HPX5 全做完"**
   - **为什么**:HPX5 全是"接已冻 schema 的线",改动局限在 emitter / runtime / 字节通道,**不动 contract**,可在一个 sprint 内安全收口;HPX6 引入新 client→server 帧、新 HTTP routes、新 item projection 层,**会动 contract**,需要单独的 review/freeze 周期。两者强行合一会让 HPX5 的"低风险快收口"被 HPX6 的 contract 设计拖慢。
   - **我们接受的代价**:前端在 HPX5 完成之前还要写一些 polling fallback 代码;HPX6 完成之前 retry/fork/restore 仍是 first-wave ack;runtime config 仍是 4 档 mode。
   - **未来重评条件**:never;两阶段切分是稳定姿态。

2. **取舍 2**:我们选择 **"接通已声明 emitter / capability / runtime"** 而不是 **"重新设计协议"**
   - **为什么**:三份报告高度一致地确认 nano-agent 的"形状正确性"已成熟,缺的是"时序完整性"。重新设计协议会丢掉 NACP 1.1.0 frozen baseline 和 18-doc pack 的全部资产。
   - **我们接受的代价**:某些设计选择(比如 confirmation 走 row-first dual-write 而不是直接 WS round-trip)是 HP5 已冻的,HPX5/HPX6 不能改;客户端必须接受这些已冻形状。
   - **未来重评条件**:仅在 hero-to-platform 阶段重评 NACP version bump 时整体回看。

3. **取舍 3**:我们选择 **"item projection = read-time 投影"** 而不是 **"item = 新 truth 对象"**
   - **为什么**:Codex 的 item 是 server-side mutable object;但 nano-agent 已经有 stream event ledger + D1 row 作为 truth,再引入第三种 truth 会造成 dual-write / triple-write 风险(QNA Q16 教训)。read-time projection 让 item 始终从已有 truth 投影出来,不引入新 mutable state。
   - **我们接受的代价**:item 的 created_at / updated_at 精度受限于 source row;item.completed 的判定需要在 projection 层加少量启发式规则。
   - **未来重评条件**:若 hero-to-platform 阶段需要 cross-tenant / cross-session item 索引(如 "搜索所有 file_change"),再考虑物化。

4. **取舍 4**:我们选择 **"runtime config 只在 session-scoped"** 而不是 **"既有 session-scoped 又有 turn-scoped"**
   - **为什么**:per-turn override 已经通过 `/input` body 的 `model_id / reasoning` 实现,新增 turn-scoped runtime config 会与之冲突,且 80% 的前端 UX 不需要 turn-scoped。
   - **我们接受的代价**:用户若想"只在这一轮关掉 web_search"必须 PATCH session-level runtime → input → PATCH 回去,体验略差。
   - **未来重评条件**:若前端 UX 调研显示 turn-scoped 是高频需求,在 hero-to-platform 引入。

5. **取舍 5**:我们选择 **"polling fallback 路由保留 + happy path 不依赖 polling"** 而不是 **"WS emitter 接通后废弃 polling"**(v0.2 修订,GPT R5)
   - **为什么**:WS reconnect 窗口内事件可能丢失,polling 是 reconcile 的兜底;HTTP-only client(SSR / curl 集成)也需要 polling。
   - **v0.2 修订措辞**:文档双轨说明"WS 是首选 / polling 是 reconcile fallback";**绝不**在文档里写"前端可以删除全部 polling 代码"(v0.1 措辞被指出会误导);前端 happy path 走 WS 事件驱动,reconnect 后必须有一次 reconcile 拉取。
   - **未来重评条件**:never;双轨是健康姿态。

6. **取舍 6**(v0.2 新增):我们选择 **"emit-helpers.ts 仅作为 HPX5 新 emitter 强制出口,现有 stream-event emitter 不强制迁移"** 而不是 **"全量迁移所有 emit"**
   - **为什么**:全量迁移会让 HPX5 引入大重构风险,违背"低风险快收口"心智;现有 emitter(turn.begin / turn.end / tool.call.* / llm.delta / system.notify)已 live,迁移没有立即收益。
   - **我们接受的代价**:emit 出口在 hero-to-pro 阶段是双轨的(新 helpers 与旧 deps 并存);全量收敛留 hero-to-platform。
   - **未来重评条件**:hero-to-platform 阶段做 NACP version bump 时一并收敛。

7. **取舍 7**(v0.2 新增):我们选择 **"`permission_mode` deprecated-but-kept + dual-write 1 个版本 + rule 优先 mode fallback"** 而不是 **"立即删除 mode 路由"**
   - **为什么**:已部署客户端在用 4 档 mode;立即删除是 breaking change。
   - **我们接受的代价**:hero-to-pro 阶段 D1 同时存 `permission_mode` 字段(legacy)和 `runtime.approval_policy`(新);PATCH 任一字段都触发 dual-write。
   - **未来重评条件**:hero-to-platform 阶段移除 legacy `POST /policy/permission_mode` 路由 + D1 字段。

8. **取舍 8**(v0.2 新增):我们选择 **"executor 走 Cloudflare Queue consumer 主路径 + DO alarm 兜底监控"** 而不是 **"DO alarm 自驱动"或"新建专用 executor DO"**
   - **为什么**:DO alarm 30s 单次执行上限对 restore 大量 R2 复制不安全(kimi §3.3);Queue 提供至少一次投递 + 长 timeout + dead-letter,配合幂等 executor 实现 retry-safe;新建专用 DO 增加部署复杂度且无明显收益。
   - **我们接受的代价**:F11/F12/F13 的 wrangler.jsonc 需要新增 Queue binding;部署需要额外的 Queue producer/consumer 配置;dead-letter queue 需要监控告警。
   - **未来重评条件**:若 Cloudflare 推出更适合长任务的 runtime(如 Workers Workflow)再迁移。

### 6.2 风险与缓解(v0.2 扩充)

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| HPX5 emitter 接通后,与 HTTP polling 形成 race | client 同时订阅 WS 和 polling | UX 卡顿 / 重复弹窗 | confirmation_uuid 全局唯一;前端 reducer 用 uuid 做 dedup;`409 confirmation-already-resolved` 已经是兜底 |
| **(v0.2 新增)emit-helpers.ts 跨 worker bridge 失败** | orchestrator-core row write 成功但 service binding 不可达 | confirmation/todos 帧丢失 | row write 是 truth;emit 失败 fall back 到 `system.error`(stream-event family);客户端通过 reconnect 后 polling 兜底拉取 |
| WriteTodos at-most-1 in_progress invariant 冲突 | LLM 调用 WriteTodos 时不知道 invariant | 频繁 `409 in-progress-conflict` | agent-core kernel 在调用前自动 close 上一个 in_progress;capability 文档明确 |
| **(v0.2 新增)WriteTodos tool schema 漂移** | LLM 学会的 tool 名 vs agent-core capability 注册名不一致 | LLM tool_use 调不到 capability | tool schema 在 nacp-session 一处冻结,agent-core 与 prompt 通过 schema 派生 |
| auto-compact mid-turn 触发 | context_window 接近上限时正在 stream | LLM 输出截断或重启 | auto-compact 仅在 turn 边界触发,**绝不**中断 stream;`compact-breaker.ts` 已实现 3 次熔断 |
| **(v0.2 新增)F6 tool-calls D1 写入性能退化** | 每次 tool call 增加一次 D1 write | tool execution 延迟上涨 | fire-and-forget(`waitUntil`);D1 写失败不阻塞 stream;失败计入 metric |
| F12 restore executor 失败后 D1 状态一致性 | restore 中途 worker 崩溃 | 残留 partial state | Q24 `failure_reason`;Queue at-least-once + 幂等 executor;dead-letter 后强制 `rolled_back` |
| **(v0.2 新增)F12 restore R2 大文件复制超时** | 大量 workspace 文件单 job 复制 | DO alarm 30s 上限被撞 | Queue consumer 替代 DO alarm(取舍 8);单 job 拆分为多个 R2 batch copy |
| item projection 性能退化 | session 累积上千 turn | `GET /items` 慢 | cursor-based;`limit ≤ 200`;projection 走 cursor scan 不全表;source row uuid 即 item_uuid 保证稳定引用 |
| **(v0.2 新增)item projection source row 被 compact 后 item 失效** | compact 后历史 D1 row 被聚合 | item_uuid 失效,前端引用断 | compact 只 archive 不删除;item projection 在 source 缺失时返 `404 item-archived`;前端 UI 标"已归档" |
| followup_input WS 帧被滥用作"绕过 confirmation" | 客户端用 followup 注入 "yes, run it" | 安全风险 | followup_input 只 append 到 user message,不影响 confirmation row;confirmation 必须走 HTTP decision |
| **(v0.2 新增)followup_input 与 retry/cancel actor-state race** | 用户在 turn_running 中同时点 retry + push followup | actor-state 状态机歧义 | F8/F11/cancel 在 HPX6 早期统一建模 actor-state;pendingInputs 队列加 source 字段(followup / retry / messages) |
| runtime.permission_rules 与 session permission_mode 冲突 | 同时设了 mode=ask 和 rule=always-allow | runtime 不知道按谁来 | rule 优先级高于 mode(Q-bridging-7);rule 命中即终态;mode 是 fallback;PATCH `/policy/permission_mode` dual-write 到 `approval_policy` |
| **(v0.2 新增)runtime.web_search / network_policy 字段写入但无 capability 消费** | F9 字段集超出当前 agent-core 能力 | config 无效写入,前端误以为生效 | F9 第一版仅暴露已有 capability 对应的字段;`web_search / network_policy` 在 capability 实装前文档标 `not-yet-enforced` |
| 文档断点修复改动 confirmation decision body shape | 现存客户端正在用 legacy `decision/payload` | breaking change | dual-accept(`status` 与 `decision` 同接受 1 个版本);docs 标 `status` 为 canonical;`decision` 标 deprecated |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己(我们)**:从"客户端必须在 7 个盲点写防守式代码"压缩到"客户端只写 reducer + UI";dogfood 内部前端开发速度提升一档。
- **对 nano-agent 的长期演进**:HPX5 完成后 nano-agent 真正兑现 README 的 "WebSocket-first" 承诺;HPX6 完成后兑现 "agent runtime 而非 chat 后端" 承诺,为 hero-to-platform 阶段的 sub-agent / multi-tenant 扩展打好 runtime config 基础。
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**:
  - **上下文管理**:S3 接通 auto-compact 后,长 session 不再撞 window;客户端不需自管 context。
  - **Skill**:S2 WriteTodos 让 plan/skill 成为 agent 一等对象,后续 skill registry 可以挂 todo 模板。
  - **稳定性**:S11–S13 的 executor 化让 retry/fork/restore 从"假按钮"变"真能力",降低用户在生产中遇到"点了没反应"的概率。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

#### HPX5 功能(wire-up + bounded surface completion)— v0.2 修订

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| **F0** | (v0.2 新增)emit-helpers infra | 新建 `packages/nacp-session/src/emit-helpers.ts`;在 `runtime-assembly.ts` 注入 `emitTopLevelFrame` deps | ✅ helper 文件 live;F1/F2/F4 经它统一出口;cross-worker bridge 封装完整 |
| **F1** | confirmation WS emitter wire-up(独立顶层帧) | confirmation row 写入 / 状态变化时 emit `session.confirmation.request/.update`(**不**经 stream-event 包装) | ✅ 客户端在 attached 状态下,confirmation 创建后 ≤500ms 收到 WS push |
| **F2** | WriteTodos capability(三子任务)+ WS emitter | F2a:tool schema 注册;F2b:execution 路由到 `D1TodoControlPlane` + 自动 close in_progress;F2c:WS emit `session.todos.write/.update` | ✅ LLM 调用 WriteTodos 时 D1 落地,WS 帧 ≤500ms 内 emit |
| **F3** | auto-compact runtime trigger + body 透传(v0.2 措辞修订) | 在 `runtime-mainline.ts` 注入 `composeCompactSignalProbe`;turn 边界触发;façade 透传 `force / preview_uuid / label` 到 context-core | ✅ session 在 `effective_context_pct ≥ threshold` 且非 streaming 时自动触发 compact;手动 body 字段真实生效;`compact.notify` 完整 4 状态链路 emit |
| **F4** | model.fallback WS emitter(field 名以 schema 为准) | agent-core 在 fallback 决策点 emit `model.fallback {turn_uuid, requested_model_id, fallback_model_id, fallback_reason}` | ✅ fallback 发生后 ≤500ms 客户端收到 push |
| **F5** | workspace bytes GET(façade pass-through) | `GET /sessions/{id}/workspace/files/{*path}/content` 复用 filesystem-core `readTempFile` RPC | ✅ LLM 写出的 workspace temp file 可直接读取字节;25 MiB cap;`Content-Type` / `Content-Length` 正确 |
| **F7** | 文档断点修复 + reference 行号刷新 | D1–D7 + GPT §6.1–6.6 共 13 处 + orchestrator-core 模块化后的 implementation reference 全部刷新 | ✅ 18-doc pack 内**零**契约不一致;`scripts/check-docs-consistency.mjs` 在 CI 通过 |

#### HPX6 功能(workbench + 新 truth + 对象层)— v0.2 修订

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| **F6** | (v0.2 移入 HPX6)tool-calls 真实化 ledger | 新建 D1 `nano_tool_call_ledger`;agent-core fire-and-forget 写入;`GET /tool-calls` + `GET /tool-calls/{request_uuid}` detail | ✅ 历史 tool call 可查询;detail 含完整 input/output |
| **F8** | followup_input public WS frame(完整 frozen shape) | 暴露 `session.followup_input`;**保留 nacp-session 已冻完整 shape**;首版前端 MVP 只依赖 text | ✅ 客户端在 `attached / turn_running` phase 可 push followup;agent-core 接受并入队 `pendingInputs` |
| **F9** | runtime config object + 新 D1 表 | 新建 `nano_session_runtime_config`;`GET/PATCH /sessions/{id}/runtime` + `RuntimeConfigSchema` | ✅ runtime config session-scoped 可读可写;PATCH 触发 `session.runtime.update` 顶层帧 |
| **F10** | per-tool / per-pattern permission rules + dual-write | `runtime.permission_rules[]`;rule 优先 > mode fallback;`POST /policy/permission_mode` 在 hero-to-pro dual-write 到 `approval_policy` | ✅ "always allow Read" / "Bash 限定 git status" 可表达;legacy mode 路由保留 1 版本 |
| **F11** | retry executor(Queue 主路径) | Queue consumer 处理 retry job;`POST /retry` 创建真实 attempt-chain | ✅ retry 触发新 turn,client 可看到 `turn.attempt > 1` |
| **F12** | restore executor(Queue + DO alarm 兜底) | Queue consumer + DO alarm 监控;drive `nano_checkpoint_restore_jobs.status` to terminal | ✅ restore 在 ≤120s 内推到 terminal(SLA v0.2 调宽,适应 Queue);`session.restore.completed` 顶层帧 emit |
| **F13** | fork executor(Queue 主路径) | Queue consumer;drive `nano_session_fork_lineage`;emit `session.fork.created` | ✅ fork 在 ≤30s 创建 child session;snapshot copy / lineage 完整 |
| **F14** | item projection 层(read-time + Source-of-Truth matrix) | `GET /sessions/{id}/items[?cursor=]` + `GET /items/{uuid}` + WS `session.item.{started,updated,completed}` 顶层帧族 | ✅ 7 类 item 可通过 HTTP 查询和 WS 订阅;source map 文档化(附录 C) |
| **F15** | file_change item 与 emitter | LLM 写 workspace file 时 emit `file_change` item(path / change_kind / size_delta / content_hash);依赖 F5 + F14 | ✅ 前端 file diff viewer 可订阅 file_change 流 |

### 7.2 详细阐述

#### F0(v0.2 新增):emit-helpers infrastructure

- **输入**:HPX5 第一周开发任务,无业务输入。
- **输出**:`packages/nacp-session/src/emit-helpers.ts` 文件;`runtime-assembly.ts` 的 deps 接口扩展 `emitTopLevelFrame(message_type, body)`。
- **主要调用者**:F1(confirmation)、F2(todos)、F4(model.fallback)的 emitter 实现。
- **核心逻辑**:
  - helper signature:`emit(messageType: SessionMessageType, body: unknown, ctx: { sessionUuid, traceUuid }) → Promise<EmitResult>`
  - 内部用 `SESSION_BODY_SCHEMAS[messageType].safeParse(body)` 校验
  - 校验通过则走 cross-worker bridge:orchestrator-core → User DO via service binding → WS frame emit;agent-core 内部 emit 直接走 `runtime-assembly.ts` 注入的 `emitTopLevelFrame` deps
  - 校验失败 fall back 到 `system.error`(stream-event family);**绝不**静默丢帧
  - emit latency 写入 `nano_emit_latency_ms` metric
- **边界情况**:client 未 attached 时,帧进入 reconnect buffer;buffer 溢出走 `system.error`。
- **一句话收口目标**:✅ **emit-helpers.ts live;F1/F2/F4 都从此出口 emit;cross-worker bridge 封装完整;现有 stream-event emitter 不强制迁移。**

#### F1: confirmation WS emitter wire-up(独立顶层帧,v0.2 修订)

- **输入**:HP5 confirmation control plane 在 `nano_session_confirmations` row write 之后调用 F0 emit-helpers。
- **输出**:`session.confirmation.request`(create 时)、`session.confirmation.update`(status 变化时)— 走**独立顶层 WS frame**(Q-bridging-6),**不**经 `session.stream.event` 包装,**不**扩展 `SessionStreamEventBodySchema`(已是冻 13-kind union)。
- **主要调用者**:`workers/orchestrator-core/src/confirmation-control-plane.ts`(HP5 row-first dual-write 之后);legacy `/permission/decision` `/elicitation/answer` dual-write 路径。
- **核心逻辑**:
  - row-first 写成功后,从 orchestrator-core 经 service binding 把 emit 请求转给 User DO
  - User DO 的 `emitServerFrame` 直接 emit 顶层 frame(已支持非-stream-event 顶层帧,如 `session.heartbeat` / `session.update`)
  - 校验走 `SESSION_BODY_SCHEMAS["session.confirmation.request"|"session.confirmation.update"]`(messages.ts 已注册)
- **边界情况**:dual-emit 窗口不需要(confirmation 只走新帧族,legacy `session.permission.request` 已不再 emit);`409 confirmation-already-resolved` 仍然是终态成功。
- **一句话收口目标**:✅ **confirmation 帧在 row write 后 ≤500ms emit;前端 happy path 走事件驱动;polling 保留作为 reconcile fallback。**

#### F2: WriteTodos capability(三子任务)+ WS emitter(v0.2 拆分)

- **F2a: tool schema 注册**
  - 在 agent-core capability registry 内新增 WriteTodos tool schema(LLM 可见)
  - schema:`{ name: "write_todos", input: { todos: [{ content, status?, parent_todo_uuid? }], request_uuid? } }`
  - 走 `nacp-session/messages.ts` 的 `SessionTodosWriteBodySchema`(已冻)
- **F2b: tool execution 路由**
  - LLM 触发 `tool_use { name: "write_todos", input }` 时,agent-core kernel 把它路由到 `D1TodoControlPlane`(已 live)
  - capability 内部自动 close 上一个 in_progress 避免 Q19 at-most-1 invariant 冲突
  - tool_result 给 LLM 返回结构化 ack(成功 todo_uuid 列表 / 失败原因)
- **F2c: WS emit**
  - row write 成功后走 F0 emit-helpers,emit 顶层帧 `session.todos.write`(模型侧的 upsert 命令镜像)与 `session.todos.update`(authoritative state 广播)
  - 与 F1 同形:走独立顶层帧,不经 stream-event 包装
- **边界情况**:LLM 在同一次 WriteTodos 中提交 2 个 in_progress → 取第一个,其余降为 pending + emit 一条 `system.notify(severity=info)` 解释;tool_use 输入超长(> 100 todos)→ 截断 + 警告。
- **一句话收口目标**:✅ **LLM 可直接管理 todo;WS emitter ≤500ms 内 push;前端 todo 区从用户面板升级为 agent 工作板。**

#### F3: auto-compact runtime trigger + façade body 透传(v0.2 修订:措辞与 baseline 校准)

- **输入**:每次 turn.end 之后,`ContextProbe` 计算的 `effective_context_pct` ≥ 阈值(默认 0.85,可由 model `auto_compact_token_limit` 调整)。
- **输出**:auto-triggered compact job + `compact.notify {status: started}` → ... → `compact.notify {status: completed, tokens_before, tokens_after}`。
- **主要调用者**:agent-core orchestration 在 turn 边界 `runStepLoop` 的 scheduler 检查;手动 `/context/compact/preview` `/context/compact` 路由也走同一 path。
- **核心逻辑**(v0.2 修正:**不是**"解除 hardcoded false"):
  - 一手核查显示 `workers/agent-core/src/host/orchestration.ts:314-322` 已经实现 `if (this.deps.probeCompactRequired) { ... }` 的 default-off, optionally wired 模式
  - `workers/agent-core/src/host/compact-breaker.ts` 的 `composeCompactSignalProbe(budgetSource, breaker)` + 3 次熔断 + 7 分钟冷却已**完整实现**
  - **真正缺的**:`workers/agent-core/src/host/runtime-mainline.ts` 没有把 `composeCompactSignalProbe` 注入到 `SessionOrchestrator` 的 deps;`budgetSource` 没有接 context-core token 探针
  - façade 层 `workers/orchestrator-core/src/facade/routes/session-context.ts:103-114` 不读取 request body — 必须改成读 `force / preview_uuid / label` 并透传到 context-core RPC
  - context-core RPC 必须接受这些参数(评估范围:façade → orchestrator-core RPC → context-core 整条链路)
- **边界情况**:**绝不**在 turn 内 stream 时触发;失败时不阻塞 user input(即使 context 可能溢出,也由 LLM API 自然报错,不死锁);压缩后保留最近历史比例参考 gemini-cli `COMPRESSION_PRESERVE_THRESHOLD = 0.3` 默认值。
- **一句话收口目标**:✅ **`composeCompactSignalProbe` 接到 SessionOrchestrator deps;长 session 在 turn 边界自动 compact;手动 body 字段真实透传;`compact.notify` 完整 4 状态(started/completed/failed/skipped)路径 live。**

#### F4: model.fallback WS emitter(v0.2 字段名以 schema 为准)

- **输入**:agent-core 在 model 选择失败 → fallback 时(Q8 single-step)。
- **输出**(v0.2 修正字段名,以 `stream-event.ts:139-145` 已冻 schema 为准):
  - `model.fallback { kind: "model.fallback", turn_uuid, requested_model_id, fallback_model_id, fallback_reason }` 帧
  - `model.fallback` 是 stream-event family 子类型(已在 `SessionStreamEventBodySchema` discriminated union 内,**不**走 F0 emit-helpers,直接走现有 `pushStreamEvent`)
  - 同一 commit 写 `nano_conversation_sessions.fallback_used = 1` + `fallback_reason`(已 live)
- **主要调用者**:`workers/agent-core/src/host/runtime-mainline.ts` 的 model resolution + `user-do/message-runtime.ts` 的 turn 关闭路径(当前固定写 `fallback_used: false, fallback_reason: null`,需替换为真实值)。
- **核心逻辑**:在已经写 D1 的同一 commit 之后 push stream event 帧;**字段名严格对齐 schema**(`fallback_model_id` 不是 `effective_model_id`)— 18-doc pack 中如有 `effective_model_id` 表述,F7 一并修齐。
- **边界情况**:fallback 在 streaming 中发生 → 帧在当前 turn 的 stream 之间穿插发送;client reducer 必须容忍乱序到达。
- **一句话收口目标**:✅ **fallback 不再静默,前端 model badge ≤500ms 内更新;字段名与 schema 一致。**

#### F5: workspace bytes GET(façade pass-through,v0.2 验证基线)

- **输入**:`GET /sessions/{id}/workspace/files/{*path}/content`(`x-trace-uuid`)。
- **输出**:binary-content profile,`Content-Type / Content-Length` + raw bytes。
- **主要调用者**:前端文件浏览器 / IDE-style diff viewer。
- **核心逻辑**(v0.2 已验证):
  - `workers/filesystem-core/src/index.ts:160-175` 的 `readTempFile` RPC **已 live**(`{ ok, r2_key, bytes, mime }`);F5 是纯 façade pass-through
  - orchestrator-core `hp-absorbed-routes.ts` 在现有 metadata read 路径基础上新增 `/content` 子路径分支
  - path 走 7-rule normalize(Q19);tenant boundary 强校验;25 MiB cap
  - 当前 metadata read 返回的 `content_source: "filesystem-core-leaf-rpc-pending"` 改为 `"live"` 表示 bytes 路径已通
- **边界情况**:metadata 存在但 R2 object 不存在(snapshot 中途)→ `409 workspace-file-pending`;超 25 MiB → `413 payload-too-large`;path traversal → `400 invalid-input`(已有 normalize)。
- **一句话收口目标**:✅ **前端可直接读取 LLM 生成的文件字节;binary profile 与 artifact bytes 路径形状一致。**

#### F6: tool-calls 真实化 ledger(v0.2 移入 HPX6,新增 D1 truth)

- **输入**:`GET /sessions/{id}/tool-calls?cursor=&status=` 与 `GET /sessions/{id}/tool-calls/{request_uuid}`。
- **输出**:tool call row 列表 + 单条 detail。detail 含 `tool_name / input(redacted) / output(可能 R2 spill) / status / cancel_initiator? / started_at / ended_at / error_message?`。
- **主要调用者**:前端 transcript 翻历史、replay UI、debug 面板。
- **核心逻辑**(v0.2 修订:**新增 D1 truth 表**,**不是** wire-up):
  - **新建 migration** `nano_tool_call_ledger` D1 表(field set:request_uuid PK / session_uuid / tool_name / input_json(可能 R2 spill 时存 r2_key) / output_json(同) / status / started_at / ended_at / cancel_initiator / error_message)
  - agent-core 在 tool execution 路径上 fire-and-forget 写入 D1(`waitUntil`,不阻塞 stream)
  - `GET /tool-calls` 真实读 D1 cursor scan;`GET /tool-calls/{request_uuid}` 单行 detail
  - input/output 走 `applyToolResultBudget` 同款规则,过大写 R2 + 返预览 + `output_r2_key`
- **边界情况**:超过 budget 的 output 截断 + 提供 `output_r2_key` 可二次拉取;cancel_initiator 取自 `tool.call.cancelled` 帧的 D1 dump;D1 写失败不阻塞 stream(`waitUntil` 异常计入 metric)。
- **一句话收口目标**:✅ **`/tool-calls` 不再返空;detail 路由 live;前端可基于 D1 真相回放任意 tool call;tool execution 性能不退化(D1 写 fire-and-forget)。**

#### F7: 文档断点修复

- **输入**:三份调查报告中提到的所有断点(D1–D7 + GPT §6.1–6.6)。
- **输出**:18-doc pack 全部一致;新增 `client-cookbook.md` 章节(可选独立文件)收口 envelope unwrap、(trace_uuid,code) dedup、`first_event_seq` 兜底等 helper。
- **主要调用者**:前端开发者、SDK 集成方。
- **核心逻辑**:逐文档 sanity check + diff 修订;新增 `/start` response field `first_event_seq`;统一 confirmation kind 为 `tool_permission` / decision body 为 `status + decision_payload`;`session_status` 7 值枚举写进 transport-profiles.md;timeline / history 补完整 schema 示例。
- **边界情况**:`decision/payload` legacy 字段 dual-accept 一个版本(标 deprecated),给客户端迁移窗口。
- **一句话收口目标**:✅ **18-doc pack 内零契约不一致;`scripts/check-docs-consistency.mjs`(若不存在则新建)在 CI 通过。**

#### F8: followup_input public WS frame(v0.2 修订:保留完整 frozen shape)

- **输入**:client→server WS `{ kind: "session.followup_input", payload: SessionFollowupInputBody }`,其中 body 走 `messages.ts:119-126` **已冻完整 shape**:`{ text(必填), context_ref?, stream_seq?, model_id?, reasoning?, parts?(1..32) }`。**绝不**收窄到 `{text}` only(Q-bridging-3)。
- **输出**:agent-core 把 followup append 到 `actorState.pendingInputs` 队列;不打断当前 stream;turn 结束后由 `drainNextPendingInput()`(已存在)消费,下一轮 user prompt 包含 followup 内容。
- **主要调用者**:前端 chat UI 的"发送"按钮(在 turn_running 时可用);SDK 集成方可用 advanced 字段(context_ref / parts / model_id 覆盖)。
- **核心逻辑**(v0.2 一手核查):
  - `packages/nacp-session/src/type-direction-matrix.ts:24` 已注册 `session.followup_input` 为 client→server `command`
  - `packages/nacp-session/src/messages.ts:119-126` 已冻完整 body shape
  - `workers/agent-core/src/host/orchestration.ts:429-447` 的 `drainNextPendingInput` 已实现 queue 消费
  - **真正缺的**:`workers/orchestrator-core/src/facade/routes/session-bridge.ts` 的 `SessionAction` 枚举不含 followup_input;NanoSessionDO 没有 WS message handler 分支;pendingInputs 入队 source 字段未区分(followup / retry / messages)
  - HPX6 早期与 F11(retry)、`POST /cancel` 一起统一建模 actor-state state machine
- **边界情况**:detached / ended phase 拒绝(`NACP_STATE_MACHINE_VIOLATION`);超长(>32 KB,以 schema `text.max(32768)` 为准)→ `NACP_SIZE_EXCEEDED`;**首版前端 MVP 只发 text**,advanced 字段对 SDK 集成方开放且文档明确"可选,not-yet-rendered-in-first-party-UI"。
- **一句话收口目标**:✅ **followup_input 在 public WS 可用;完整 frozen shape 暴露;首版 client 只依赖 text;agent-core 接受并入队,而不是 cancel + restart。**

#### F9: runtime config object

- **输入**:`GET /sessions/{id}/runtime` 读;`PATCH /sessions/{id}/runtime` 写。
- **输出**:`{ permission_rules: [...], network_policy: {mode}, web_search: {mode}, workspace_scope: {mounts: []}, approval_policy: enum }`。
- **主要调用者**:前端"会话设置"面板。
- **核心逻辑**:写入 `nano_session_runtime_config` 新表;PATCH 触发 `session.runtime.update` WS 帧;字段缺省值取自 team 默认。
- **边界情况**:concurrent PATCH → 乐观锁(`version` 字段),冲突 `409 conflict`;LLM 不能修改 runtime(只 user-authenticated)。
- **一句话收口目标**:✅ **runtime config 一等公民;前端可显式控制 agent 怎么运行,而不是仅靠 model + permission_mode 4 档。**

#### F10: per-tool / per-pattern permission rules

- **输入**:`runtime.permission_rules: [{ tool_name, pattern?, behavior: allow|deny|ask, scope: session|tenant }]`。
- **输出**:agent-core PreToolUse 决策时优先匹配规则;命中即终态(不 emit confirmation)。
- **主要调用者**:agent-core kernel;前端"权限设置"面板。
- **核心逻辑**:rule list 顺序匹配;支持简单 glob pattern(`git status*` / `Read */docs/*`);scope=tenant 写入 team 级表(`nano_team_permission_rules`),scope=session 写入 session 级表。
- **边界情况**:rule 与 mode 冲突 → rule 优先;rule 全 miss → 落回 mode;deny rule 命中 → emit `system.notify(severity=info, code: rule-denied)` 让 LLM 知道"这个工具被规则拒了"。
- **一句话收口目标**:✅ **"always allow Read" / "Bash 限定 git status" 一句配置,不再每次弹 confirmation。**

#### F11: retry executor

- **输入**:`POST /sessions/{id}/retry { from_turn_uuid? }`。
- **输出**:新 turn row(`requested_attempt_seed = from_turn_uuid`,`turn_attempt += 1`),drive 完整新一轮;原 turn 标 `superseded_by_turn_attempt`(已在 checkpoint diff projector 用过的语义)。
- **主要调用者**:前端"重试"按钮。
- **核心逻辑**:从 from_turn_uuid 的 user prompt 开始,重新走 turn 流程;原 assistant message 标 superseded;不复用 LLM 缓存(不同 attempt seed)。
- **边界情况**:from_turn_uuid 缺省 → 取最近一次 user turn;指定的 turn 不属当前 session → `404 not-found`。
- **一句话收口目标**:✅ **`POST /retry` 创建真实新 attempt;客户端不再需要缓存上一条 prompt 重发。**

#### F12: restore executor

- **输入**:`nano_checkpoint_restore_jobs.status = pending` 的 job(已由 HP7 substrate 的 `POST /restore` 创建)。
- **输出**:job 推到 `succeeded / partial / failed / rolled_back`;失败必填 `failure_reason`(Q24);emit `session.restore.completed` 帧。
- **主要调用者**:checkpoint plane alarm;手动 `POST /restore` 创建后立即 schedule。
- **核心逻辑**:executor 读 snapshot lineage → 复制 R2 文件回 workspace → 重置 D1 message ledger 到 watermark → 写 `target_session_uuid`;幂等;失败 alarm 兜底 retry 一次后强制 `rolled_back`。
- **边界情况**:`mode = files_only` 不动 message ledger;`mode = conversation_and_files` 同时做两件事;snapshot R2 缺 → `failure_reason: snapshot-missing`。
- **一句话收口目标**:✅ **restore 在 ≤30s 推到 terminal;`session.restore.completed` 帧 emit;前端"恢复"按钮真有效。**

#### F13: fork executor

- **输入**:`nano_session_fork_lineage` 中 `fork_status = pending-executor` 的 row(由 `POST /fork` 创建)。
- **输出**:child session DO 创建 + snapshot 复制(workspace + message ledger 至 fork_point) + emit `session.fork.created` 真实帧。
- **主要调用者**:checkpoint plane alarm;手动 `POST /fork` 创建后立即 schedule。
- **核心逻辑**:Q23 frozen "same conversation only";child session_uuid 已 mint(由 substrate);executor 复制 R2 + D1 部分行 + 设 child `parent_session_uuid`;失败回滚 child session 到 `ended` with `ended_reason: fork_failed`。
- **边界情况**:fork point 不在当前 session(跨 conversation)→ `400 invalid-fork-point`;parent session 已 ended → 仍允许 fork(snapshot 已存)。
- **一句话收口目标**:✅ **`/fork` 在 ≤10s 推到 child active;`session.fork.created` 帧 emit;前端可显示 conversation 树。**

#### F14: item projection 层

- **输入**:已有的 stream event ledger + D1 truth(message / tool_call / todo / confirmation / file_change / fallback / error)。
- **输出**:`GET /items?cursor=` 列表 + `GET /items/{uuid}` 详情 + `session.item.{started,updated,completed}` WS 帧。
- **主要调用者**:前端 workbench transcript / replay / inspect。
- **核心逻辑**:**read-time 投影**,不引入新 truth 表;item_uuid 取自 source row 的 uuid;`item.kind` ∈ `{agent_message, reasoning, tool_call, file_change, todo_list, confirmation, error}`;`item.started_at` 取自 source 创建,`item.completed_at` 取自 source 进入终态。
- **边界情况**:reasoning item 来自 `llm.delta` 中 `content_type = "reasoning"`(需 F7 先文档化 content_type 枚举);跨多 source 的 item(如 confirmation request + decision)合并为同 item_uuid 的两次 update。
- **一句话收口目标**:✅ **7 类 item 可通过 HTTP 查询和 WS 订阅;前端 reducer 不再需要从零散 stream event 拼对象。**

#### F15: file_change item 与 emitter

- **输入**:`filesystem-core` 的 writeTempFile / deleteTempFile RPC 完成。
- **输出**:`file_change` item(`path / change_kind: created|modified|deleted / size_delta / content_hash`)+ `session.item.{started,completed}` 帧。
- **主要调用者**:agent-core(LLM 写文件时);前端 IDE-style diff viewer。
- **核心逻辑**:在 filesystem-core leaf RPC 完成 ack 之后 emit;`size_delta` 由 metadata diff 计算;`content_hash` 取自 D1 已存字段。
- **边界情况**:批量写(`writeMany`)合并为单 item 的多次 updated;删除文件后再创建同 path → 新 item_uuid(不复用)。
- **一句话收口目标**:✅ **LLM 写 workspace 文件时,前端 ≤500ms 收到 file_change 帧;diff viewer 基础就位。**

### 7.3 非功能性要求与验证策略(v0.2 SLA 调整)

- **性能目标**:
  - WS emitter latency:row write commit 之后 ≤500ms emit 到 attached client(P95)。
  - auto-compact trigger latency:turn.end 之后 ≤2s 决定是否触发(若触发,job ≤30s 完成)。
  - **(v0.2 调宽)** restore executor ≤120s 推到 terminal(P95)— 适应 Queue consumer + 大量 R2 复制。
  - **(v0.2 调宽)** fork executor ≤30s — 适应 Queue 投递延迟。
  - **(v0.2 新增)** retry executor ≤10s 创建新 turn(无 R2 复制,只是 ledger 写入)。
  - `GET /items` cursor scan ≤500ms(P95,limit=50)。
  - workspace bytes GET 25 MiB ≤5s 完成下载(P95)。
  - **(v0.2 新增)** F6 D1 写入对 tool execution 的延迟影响 ≤5ms(P99,fire-and-forget)。
- **可观测性要求**:
  - 每个 emitter 记录 `nano_emit_latency_ms` 直方图(metric)。
  - 每个 executor 写 `nano_audit_log` 一条(`event_kind: restore.executed / fork.executed / retry.executed`)。
  - auto-compact 触发记录 `nano_audit_log` `event_kind: context.auto_compact`。
  - `runtime.permission_rules` 命中记录 `event_kind: permission.rule_matched` 含 rule index。
- **稳定性要求**:
  - emitter 失败必须 fall back 到 `system.error` + audit log,**绝不**静默丢帧。
  - executor 必须幂等;失败 alarm 兜底 retry 1 次后强制终态(rolled_back / fork_failed)。
  - polling fallback 路由保留,WS 不可达时 client 仍能工作。
- **安全 / 权限要求**:
  - `runtime.permission_rules` 修改必须经 user-authenticated PATCH(LLM 不能升权)。
  - workspace bytes GET 严格走 tenant boundary;path 走 7-rule normalize。
  - `followup_input` 不能用于回应 confirmation(必须走 HTTP decision)。
  - tool-calls detail input/output 走 sensitive-field redact(已存在的 PII filter)。
- **测试覆盖要求**:
  - 每个 emitter 有 e2e 测试覆盖"row write → WS receive"完整链路。
  - 每个 executor 有 e2e 测试覆盖"pending → terminal"包括失败回滚。
  - polling fallback 与 WS push 并发场景 dedup 测试。
  - cross-package contract 测试 `pnpm test:contracts` 必须 100% 过。
- **验证策略**:
  - **HPX5 收口 demo**:用前端最小 client(可以是 e2e 脚本)模拟一次完整 turn,确认 confirmation / todos / file_change / model.fallback 都通过 WS 收到,**不**触发任何 polling fallback。
  - **HPX6 收口 demo**:用前端 workbench client 发起 retry / fork / restore,确认三者在 SLA 内推到 terminal;PATCH runtime 后 confirmation 行为符合规则;通过 followup_input 在 turn 中干预并验证下一轮 prompt 包含 followup 文本;item projection 列出全部 7 类 item。
  - **manual evidence pack**:HPX6 收口 demo 必须有完整录屏 + WS frame trace,作为 hero-to-pro 阶段冻结的最终证据(承袭 HP9 evidence pack 法律)。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/query.ts:1-200` | queryLoop 整体结构 | F11 retry executor 的 attempt 概念 | 不照抄 streaming executor |
| `context/claude-code/query.ts:241-540` | autocompact 触发 + circuit breaker | F3 auto-compact 的失败 N 次熔断 | 借 circuit breaker 思想 |
| `context/claude-code/Tool.ts:362-500` | Tool 接口 / canUseTool 阻塞语义 | F1 confirmation 的 sync block 心智 | 仅借语义 |
| `context/claude-code/types/permissions.ts:33-100` | PermissionMode + PermissionRule + PermissionRuleSource | F10 permission_rules schema 字段命名 | rule source / behavior 直接对齐 |
| `context/claude-code/services/tools/toolOrchestration.ts:19-82` | runTools 串/并行 partition | F6 tool-calls ledger 的 batch 概念 | 仅借分批观念 |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/sdk/typescript/...` (GPT 报告 §2.2 引用) | `ThreadItem` 类型定义 | F14 item projection 的 7 类 item 命名 | `mcp_tool_call` / `web_search` 暂留扩展点 |
| `context/codex/sdk/typescript/...` (GPT 报告 §2.2 引用) | `ThreadOptions` 字段集 | F9 RuntimeConfigSchema 的字段选取 | 只取最小 5 字段 |

### 8.3 来自 gemini-cli

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/gemini-cli/...` (DeepSeek §2.4 引用) | Scheduler TOOL_CONFIRMATION_REQUEST/RESPONSE pattern | F1 emitter 接线方式(row write 之后 emit) | 不引入 MessageBus 抽象 |
| `context/gemini-cli/...` (DeepSeek §2.6 引用) | ChatCompressionService 阈值触发 | F3 auto-compact 的阈值触发 | 阈值默认 0.85,可由 model 调整 |

### 8.4 本仓库 precedent / 需要避开的反例(v0.2 校准)

| 文件:行 | 问题 / precedent | 我们借鉴或避开的原因 |
|---------|------------------|----------------------|
| `workers/agent-core/src/host/orchestration.ts:314-322` | **default-off, optionally wired** `probeCompactRequired`(v0.2 修正:**不是** hardcoded false) | F3 接线方式:在 `runtime-mainline.ts` 注入 `composeCompactSignalProbe`,不要在 orchestration.ts 重做 |
| `workers/agent-core/src/host/compact-breaker.ts` | `composeCompactSignalProbe` + 3 次熔断已**完整实现** | F3 不要重做 circuit breaker,直接复用 |
| `workers/orchestrator-core/src/confirmation-control-plane.ts:96-131` | HP5 row-first dual-write(Q16) | F1 emitter 必须在 row write 成功之后,**绝不**在 row write 之前 emit |
| `workers/orchestrator-core/src/facade/routes/session-context.ts:103-114` | body 字段静默 ignore | F3 必须真实读取 body 并透传到 context-core RPC |
| `workers/agent-core/src/host/workspace-runtime.ts` (Lane E retained-with-reason) | host-local workspace residue | F5 / F15 必须走 filesystem-core leaf RPC,不在 host-local 复制 |
| `workers/filesystem-core/src/index.ts:160-175` | `readTempFile` RPC **已 live** | F5 仅做 façade pass-through,**不**改 filesystem-core RPC |
| `packages/nacp-session/src/type-direction-matrix.ts:24,37-43` | direction matrix `session.followup_input` / `session.confirmation.*` / `session.todos.*` 已注册 | F1/F2/F8 不需改 matrix,只需补 emit / accept handler |
| `packages/nacp-session/src/messages.ts:119-126,304-393` | followup_input / confirmation / todos body schema 已冻 | F1/F2/F8 不动 schema,直接复用 |
| `packages/nacp-session/src/stream-event.ts:147-161` | 13-kind discriminated union 已冻 | F1/F2 confirmation/todos **不在** union 内,必须走独立顶层帧(Q-bridging-6) |
| `workers/agent-core/src/kernel/session-stream-mapping.ts:9-34` | live push seam 仅 9-kind | F1/F2/F4 emitter 接线必须扩展此 seam,**或**走独立顶层帧路径 |
| `workers/orchestrator-core/src/facade/routes/session-bridge.ts:14-33` | `SessionAction` 枚举不含 followup_input | F8 必须添加 followup_input,且 NanoSessionDO 同步加 WS handler |
| `workers/orchestrator-core/src/hp-absorbed-routes.ts:158-170` | `/tool-calls` 返空 stub | F6 必须新增 D1 truth 表 + 真实读取(HPX6,不是 HPX5) |
| `workers/orchestrator-core/src/index.ts` (实际 18 行,已模块化) | implementation reference 行号在 18-doc pack 中失效 | F7 scope 含刷新所有 docs 中的 implementation reference 到新模块化结构 |

---

## 9. QNA / 决策登记与设计收口

### 9.1 需要冻结的 owner / architect 决策(v0.2 扩充到 8 条)

| Q ID | 问题 | 影响范围 | 当前结论 | 状态 | 答复来源 |
|------|------|----------|----------|------|----------|
| Q-bridging-1 | HPX5 emitter / capability / runtime 接线是否需要 NACP version bump? | 全 contract | 否,保持 1.1.0 | answered | 本文 §0.4 |
| Q-bridging-2 | WS emitter 接通后 polling 路由是否保留? | client UX / docs | 保留;happy path 不依赖,但 reconcile 永远存在 | answered | 本文 §0.4 / §6.1 取舍 5 |
| Q-bridging-3 | followup_input 暴露到 public WS 时是否收窄 frozen shape? | protocol layer | **不收窄**,完整 shape 暴露;首版 client MVP 只依赖 text | answered | 本文 §0.4 / §7.2 F8 |
| Q-bridging-4 | runtime config 是 session-scoped 还是 turn-scoped? | API shape | session-scoped;per-turn 仍走 /input body | answered | 本文 §0.4 / §6.1 取舍 4 |
| Q-bridging-5 | retry/fork/restore executor 是否需要新 D1 表? | 数据模型 | 否,复用已冻表 | answered | 本文 §0.4 |
| **Q-bridging-6** | confirmation/todos WS 帧走 stream-event body 还是独立顶层帧? | emit seam / nacp-session schema | **独立顶层帧**;不扩展 `SessionStreamEventBodySchema` | answered (v0.2) | 本文 §0.4 / §3.4 / §7.2 F1 |
| **Q-bridging-7** | `permission_mode` vs `runtime.permission_rules / approval_policy` 共存策略? | API shape / migration | rule 优先 > mode fallback;dual-write 1 个版本;hero-to-platform 删 legacy | answered (v0.2) | 本文 §0.4 / §6.1 取舍 7 / §7.2 F10 |
| **Q-bridging-8** | retry/fork/restore executor 跑在哪种 Cloudflare runtime? | 部署架构 | Queue consumer 主路径 + DO alarm 兜底监控 | answered (v0.2) | 本文 §0.4 / §6.1 取舍 8 / §7.2 F11–F13 |

### 9.2 设计完成标准(v0.2 扩充)

设计进入 `frozen` 前必须满足:

1. 三份调查报告(claude-code / codex / gemini-cli)的所有 P0/P1 缺口在本文 §5.1 / §7 内有明确归宿(F0–F15 共 16 项全覆盖)。
2. **三份评审报告(deepseek / GPT / kimi)的 blocker 反馈在本文 v0.2 修订中全部吸收**:
   - GPT R1(phase 边界)→ §0.2 + §5.1 phase 重排说明 + F6 移入 HPX6
   - GPT R2(emit seam)→ F0 新增 + §3.4 cross-worker bridge + Q-bridging-6
   - GPT R3(F3 baseline)→ F3 重写 baseline 描述
   - GPT R4(truth owner)→ 附录 C Source-of-Truth matrix
   - GPT R5(protocol drift)→ §6.1 取舍 5 措辞修订 + Q-bridging-3 + F8 完整 frozen shape
   - kimi 4 项最高优先级修正全部反映在 F1/F2/F6/F8 + 取舍 8
   - deepseek 3 项 nuance 全部修齐(F3 措辞 / F8 phase 评估 / 18-doc reference 行号刷新)
3. §0.4 的 8 条 bridging-Q(v0.2 扩充)全部 answered。
4. §7.3 非功能性要求中的 SLA 数值经 owner 确认可接受(v0.2 调整:restore ≤120s / fork ≤30s / retry ≤10s / emitter ≤500ms / D1 写 ≤5ms)。
5. §6.2 风险与缓解全部有具体方案(v0.2 共 14 条,不留 TBD)。
6. 所有影响 action-plan 执行路径的问题都已在本设计或 QNA register 中回答。

### 9.3 下一步行动

- **可解锁的 action-plan**(本设计冻结后立即开):
  - `docs/action-plan/hero-to-pro/HPX5-wire-up-action-plan.md`(覆盖 F0–F5 + F7 共 7 项)
  - `docs/action-plan/hero-to-pro/HPX6-workbench-action-plan.md`(覆盖 F6 + F8–F15 共 9 项)
- **需要同步更新的设计文档**:
  - `docs/design/hero-to-pro/HP5-confirmation-control-plane.md` — 在 closure 章节追加 "HPX5 接通 emitter" 链接
  - `docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md` — 在 closure 章节追加 "HPX5 WriteTodos / workspace bytes / HPX6 tool-calls 真实化" 链接
  - `docs/design/hero-to-pro/HP3-context-state-machine.md` — 追加 "HPX5 auto-compact wiring + body 透传"
  - `docs/design/hero-to-pro/HP7-checkpoint-revert.md` — 追加 "HPX6 restore/fork executor 走 Cloudflare Queue 收口"
  - `clients/api-docs/README.md` — 标记 18-doc → 19-doc(新增 `runtime.md`,可选 `client-cookbook.md`)
- **需要进入 QNA register 的问题**:
  - 无(本设计 §0.4 / §9.1 已就地闭环 8 条 bridging-Q)。

---

## 10. 综述总结与 Value Verdict

### 10.1 功能簇画像(v0.2 修订)

HPX5+HPX6 是 **hero-to-pro 阶段的最后一公里收口**。HPX5 = "schema-frozen wire-up + bounded surface completion",共 7 项(F0/F1/F2/F3/F4/F5/F7),不动 contract、不新增 truth 表、不新增 client→server WS 帧分支,但承认 F1/F2 需要新建 emit-helpers infrastructure(F0)、F2 需要在 agent-core 注册新 capability、F7 修文档时给 `/start` 加 `first_event_seq` 字段 — 这些都是 implementation-level extensions,non-breaking。完成后 nano-agent 真正兑现 README "WebSocket-first" 承诺,前端 happy path 走事件驱动,polling 退化为 reconcile fallback。HPX6 = "新 truth + 新 public 路由 + 新 client→server 帧 + Codex 风格对象层",共 9 项(F6 移自 HPX5 + F8–F15),引入 `nano_tool_call_ledger` / `nano_session_runtime_config` / `nano_team_permission_rules` 三张新 D1 表,公开 `/runtime` `/items` `/tool-calls/{uuid}` 新路由,接通 followup_input client→server 完整链路,并把 retry/restore/fork executor 跑在 Cloudflare Queue consumer + DO alarm 兜底之上。两阶段切分让 HPX5 可以在 1 个 sprint 内安全收口,HPX6 留出独立 review/freeze 周期,避免合并风险。

### 10.2 Value Verdict(v0.2 校准)

| 评估维度 | v0.1 评级 | v0.2 评级 | 一句话说明 |
|----------|---------|---------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | **5** | 直接兑现 README "WebSocket-first 持久化 agent runtime" 承诺 |
| 第一版实现的性价比 | 5 | **4** | HPX5 真正纯接线只有 F3/F4/F5/F7;F0/F1/F2 是 bounded extension;HPX6 含 3 张新表 + Queue executor,性价比降一档但 ROI 仍很高 |
| 对未来上下文管理 / Skill / 稳定性演进的杠杆 | 4 | **4** | 不变 |
| 对开发者自己的日用友好度 | 5 | **5** | dogfood 前端不再被盲点 polling 拖累 |
| 风险可控程度 | 4 | **4** | HPX5 风险低;HPX6 引入新 contract 与新 D1 表,但 §6.2 14 条风险缓解 + Q-bridging-6/7/8 三条决策已闭环 |
| **综合价值** | 5 | **5** | hero-to-pro 收口的最关键一步,缺它前端永远停在"chat 客户端"形态 |

---

## 附录

### A. 讨论记录摘要

- **分歧 1**:retry/fork/restore executor 是放 HPX5 还是 HPX6?
  - **A 方观点**:放 HPX5,因为 substrate 已就绪,只是 executor 接线,概念上和 emitter 接线类似。
  - **B 方观点**:放 HPX6,因为 executor 是真实的执行链(失败回滚 / alarm 兜底 / 幂等),复杂度高,与 HPX5 "接线" 心智不同。
  - **最终共识**:放 HPX6。理由:三份报告对 retry/fork/restore 的优先级评级偏中(Y1/Y6/P2/P5),不是阻断;HPX5 必须保持 "纯接线" 心智不混入 executor 复杂度;HPX6 的 executor 也需要与 followup_input + runtime config 一起做产品级 workbench 验证。

- **分歧 2**:item projection 层是否值得做?
  - **A 方观点**:不值得。stream event + D1 已经是 truth,前端自己 reducer 就行。
  - **B 方观点**:值得。Codex 的成功证明"对象级演进"对前端 reducer 友好度高 1 个量级;无 item projection,workbench 级前端会非常痛苦。
  - **最终共识**:做,但坚持 read-time projection 不引入新 truth(§6.1 取舍 3),把代价压到最小。

- **分歧 3**:文档断点修复(F7)是否需要单独动 contract?
  - **A 方观点**:统一 confirmation decision body 从 `decision/payload` 到 `status/decision_payload` 是 breaking change。
  - **B 方观点**:dual-accept 一个版本(标 deprecated)即可,不算 breaking。
  - **最终共识**:dual-accept 一版后在 hero-to-platform 删 legacy;HPX5 不算 contract 变更。

### B. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-05-02 | Owner + Opus 4.7 (1M) | 初稿;在三份调查报告会聚共识基础上,切出 HPX5 wire-up + HPX6 workbench 两阶段;F1–F15 共 15 项 In-Scope 功能;5 条 bridging-Q 就地闭环 |
| **v0.2** | 2026-05-02 | Owner + Opus 4.7 (1M)(基于 deepseek/GPT/kimi 三份评审一手代码核查) | **结构性修订**:F0(emit-helpers infra)新增;F6 从 HPX5 移入 HPX6(新 D1 truth);F2 拆为 F2a/b/c(承认是新 capability 链不是接线);F3 baseline 校准(`compactRequired:false` 改述为 default-off-optionally-wired);F4 字段名对齐 schema;F5 验证 readTempFile RPC 已 live;F8 保留完整 frozen shape 不收窄。**新增**:Q-bridging-6 (frame routing) / Q-bridging-7 (permission_mode 共存) / Q-bridging-8 (Queue executor)。**新增 §6.1 取舍 6/7/8;§6.2 风险扩到 14 条;§7.3 SLA 调宽 restore/fork executor;附录 C Source-of-Truth matrix**;F7 含 18-doc implementation reference 行号刷新 |

---

### C. Source-of-Truth Matrix(v0.2 新增,响应 GPT R4)

> 本附录回答"runtime config / item projection 的每一类对象,truth 在哪、谁 hydrate、谁回放" — 这是 GPT R4 的 blocker。
>
> 法则:**每个 public 对象有且仅有一个 D1 truth;public surface 与 internal runtime config 的翻译走文档化的 mapping;item projection 是 read-time 投影,不引入新 truth。**

#### C.1 Runtime Config 的 truth owner

| Public 字段 | D1 truth 表 | Internal RuntimeConfig(agent-core) | Hydration 路径 | 写入路径 |
|---|---|---|---|---|
| `permission_rules[]` (scope=session) | 新建 `nano_session_runtime_config.permission_rules_json` | `RuntimeConfig.permissionRules` | User DO attach 时从 D1 读 → service binding 推到 agent-core | `PATCH /runtime` → orchestrator-core 写 D1 → 推 agent-core hot 状态 |
| `permission_rules[]` (scope=tenant) | 新建 `nano_team_permission_rules` | 同上,team 级 merge 进 RuntimeConfig | 与 session-scoped 同链路;team 表只查一次缓存到 User DO | 同上 |
| `network_policy.mode` | `nano_session_runtime_config.network_policy_mode` | `RuntimeConfig.networkPolicy` | 同上 | 同上 |
| `web_search.mode` | `nano_session_runtime_config.web_search_mode` | `RuntimeConfig.webSearch` | 同上(若 capability 未实装,标 not-yet-enforced) | 同上 |
| `workspace_scope.mounts[]` | `nano_session_runtime_config.workspace_scope_json` | `RuntimeConfig.workspaceScope` | 同上 | 同上 |
| `approval_policy` | `nano_session_runtime_config.approval_policy` + 兼容写 `nano_conversation_sessions.permission_mode` | `RuntimeConfig.approvalPolicy` | 同上 | `PATCH /runtime` 或 legacy `POST /policy/permission_mode`(dual-write) |

**Internal RuntimeConfig 与 public runtime 的边界**:public runtime 是 user-facing 可读可写;internal RuntimeConfig 是 agent-core 的 in-memory 投影,LLM **不能**修改;`workers/agent-core/src/host/env.ts:186-209` 当前的 RuntimeConfig 仍保留作为 infra knobs(独立于 user runtime),HPX6 在它旁边新增一个 `UserRuntimeConfig` 字段,清晰分层。

#### C.2 Item Projection 的 source map

| item.kind | 来源 truth | 投影规则 | item_uuid 取自 |
|---|---|---|---|
| `agent_message` | `nano_session_messages` row(message_kind="assistant.message") | 1:1 | `message_uuid` |
| `reasoning` | stream event ledger(`llm.delta` 中 content_type=reasoning) | aggregate 同 turn 内的 reasoning chunks | turn_uuid + "-reasoning" |
| `tool_call` | `nano_tool_call_ledger`(F6 新表)+ stream event `tool.call.*` 帧 | 1:1 with row;updated 来自 stream events 聚合 | `request_uuid` |
| `file_change` | `nano_session_temp_files` metadata write event + filesystem-core RPC ack | 1:1 with metadata version | `temp_file_uuid + version` |
| `todo_list` | `nano_session_todos` 全量 snapshot(每次 todos.update 取整个 list) | snapshot of all rows for this session | session_uuid + snapshot_seq |
| `confirmation` | `nano_session_confirmations` row | 1:1 | `confirmation_uuid` |
| `error` | `nano_error_log`(D1)+ stream event `system.error` 帧 | 1:1 with log row | `log_uuid` |

**性能策略**:`GET /items?cursor=` 走 cursor pagination,**不**做 cross-table join — server 按时间窗内并行查 7 张表,在内存合并排序后返回(`limit ≤ 200` 控制 fan-out);超出窗口的 item 不返回,客户端按 cursor 翻页。

**稳定性策略**:item_uuid 全部来自 source row 的 uuid → source row 不被物理删除即 item_uuid 稳定。HPX6 起 compact / archive 操作只做 soft delete,不删除 source row(若 source 缺失,item projection 返 `404 item-archived`,前端 UI 标"已归档")。

#### C.3 emit seam 的 owner

| 帧族 | 当前 owner file | HPX5/HPX6 后 owner |
|---|---|---|
| stream-event 13-kind(已 live) | `workers/agent-core/src/host/orchestration.ts` 的 `pushStreamEvent` deps + `runtime-assembly.ts` | 不变,**不强制迁移** |
| `session.heartbeat` / `session.attachment.superseded` / `session.end` | User DO 的 `emitServerFrame` | 不变 |
| `session.confirmation.*`(F1)| F0 emit-helpers → orchestrator-core service binding → User DO emitServerFrame | 新增 |
| `session.todos.*`(F2c)| F0 emit-helpers → 同上 | 新增 |
| `model.fallback`(F4)| 已是 stream-event family 子类型,直接走 `pushStreamEvent` | 沿用,**不**走 F0 helpers |
| `session.runtime.update`(F9)| F0 emit-helpers → 同 F1 | 新增 |
| `session.restore.completed`(F12)| F0 emit-helpers + nacp-session schema 扩展 | 新增 |
| `session.fork.created`(F13)| 已注册 schema,沿用 stream-event family | 接通 emitter |
| `session.item.*`(F14)| F0 emit-helpers + nacp-session schema 扩展 | 新增 |
