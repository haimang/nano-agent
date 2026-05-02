# Nano-Agent 代码审查

> 审查对象: `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md`
> 审查类型: `mixed`
> 审查时间: `2026-05-02`
> 审查人: `GPT-5.4`
> 审查范围:
> - `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md`
> - `README.md`
> - `workers/{orchestrator-core,agent-core,context-core,filesystem-core}`
> - `packages/{nacp-session,nacp-core}`
> - `context/{claude-code,codex,gemini-cli}`
> 对照真相:
> - `README.md`
> - `packages/nacp-session/src/{messages.ts,type-direction-matrix.ts,session-registry.ts,stream-event.ts}`
> - `workers/orchestrator-core/src/{facade/routes/*.ts,hp-absorbed-routes.ts,confirmation-control-plane.ts,todo-control-plane.ts,checkpoint-restore-plane.ts}`
> - `workers/agent-core/src/{host/orchestration.ts,host/env.ts,host/http-controller.ts,host/do/session-do/ws-runtime.ts,kernel/{events.ts,session-stream-mapping.ts}}`
> - `context/claude-code/{query.ts,Tool.ts,types/permissions.ts,services/tools/toolHooks.ts}`
> - `context/codex/sdk/typescript/src/{thread.ts,threadOptions.ts,events.ts,items.ts}`
> - `context/gemini-cli/packages/core/src/{confirmation-bus/types.ts,scheduler/{scheduler.ts,confirmation.ts},context/chatCompressionService.ts,tools/tools.ts}`
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**：`该设计的两阶段方向基本正确，但当前版本还不能冻结；HPX5 被表述成“纯 wire-up / 不动 contract”这一核心判断与现状不符，且文中夹带了陈旧事实与若干过度承诺。`
- **结论等级**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **本轮最关键的 1-3 个判断**：
  1. `HPX6 作为 workbench phase 的方向成立，且与 README 的 WebSocket-first / durable runtime 定位一致。`
  2. `HPX5 不是纯“接已冻 schema 的线”；F5/F6/F7 已经触碰新的 public surface、错误语义与文档契约，phase 边界需要重写。`
  3. `设计稿低估了 confirmation/todo/model-fallback 的真实接线成本：当前 live runtime 仍只有 9-kind push seam，缺的不是几个 emit call，而是一条跨 worker 的 event bridge。`

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md`
  - `README.md`
- **核查实现**：
  - `workers/orchestrator-core/src/facade/routes/{session-bridge,session-context,session-control,session-files}.ts`
  - `workers/orchestrator-core/src/{hp-absorbed-routes.ts,confirmation-control-plane.ts,todo-control-plane.ts,checkpoint-restore-plane.ts}`
  - `workers/agent-core/src/{host/orchestration.ts,host/http-controller.ts,host/do/session-do/ws-runtime.ts,host/env.ts,kernel/{events.ts,session-stream-mapping.ts}}`
  - `packages/nacp-session/src/{messages.ts,type-direction-matrix.ts,session-registry.ts,stream-event.ts}`
  - `context/claude-code/{query.ts,Tool.ts,types/permissions.ts,services/tools/toolHooks.ts}`
  - `context/codex/sdk/typescript/src/{thread.ts,threadOptions.ts,events.ts,items.ts}`
  - `context/gemini-cli/packages/core/src/{confirmation-bus/types.ts,scheduler/{scheduler.ts,confirmation.ts},context/chatCompressionService.ts,tools/tools.ts}`
- **执行过的验证**：
  - `rg "session\\.confirmation\\.request|session\\.todos\\.write|model\\.fallback|followup_input|retry|fork|restore" workers packages`
  - `rg "queryLoop|PermissionRule|canUseTool|FallbackTriggeredError" context/claude-code`
  - `rg "TOOL_CONFIRMATION_REQUEST|TOOL_CONFIRMATION_RESPONSE|ChatCompressionService|Scheduler" context/gemini-cli/packages/core/src`
- **复用 / 对照的既有审查**：
  - `docs/eval/hero-to-pro/api-gap/{claude-code-compared-by-opus.md,codex-compared-by-GPT.md,gemini-cli-compared-by-deepseek.md}` — `仅作为线索入口；本轮所有实现判断均回到 context/ 真实代码重新取证，不把三份报告当作实现证据。`

### 1.1 已确认的正面事实

- `HPX6 想补的核心方向是对的：Codex 的 ThreadEvent + ThreadItem + ThreadOptions 确实证明 workbench client 需要“对象层 + runtime knobs”，而不是只靠 raw stream reducer；见 context/codex/sdk/typescript/src/{events.ts:42-80,items.ts:9-127,threadOptions.ts:1-20,thread.ts:77-95}。`
- `nano-agent 当前协议层已经冻结了 followup_input / confirmation / todos / model.fallback / session.fork.created 等消息家族，因此“优先复用既有协议资产”这一大方向成立；见 packages/nacp-session/src/{messages.ts:110-127,414-418,type-direction-matrix.ts:24,37-43,session-registry.ts:23-40,41-53,55-69,113-163,stream-event.ts:40-48,139-179}。`
- `当前仓库已经存在 retry/fork/restore/todo/workspace 的 durable substrate，不是凭空造新能力：todo 有 D1 truth，restore 有 job 表，filesystem-core 有 temp-file bytes RPC，retry/fork 也已有 first-wave route；见 workers/orchestrator-core/src/{todo-control-plane.ts:79-258,checkpoint-restore-plane.ts:54-106,184-203,hp-absorbed-handlers.ts:9-70,facade/routes/session-control.ts:233-287} 与 workers/filesystem-core/src/index.ts:133-205。`

### 1.2 已确认的负面事实

- `当前 live push seam 仍只有 9-kind：agent-core 的 SessionStreamKind 只覆盖 turn.begin / turn.end / llm.delta / tool.call.* / hook.broadcast / compact.notify / system.notify / session.update，未纳入 confirmation / todos / model.fallback / item / system.error / fork 等；见 workers/agent-core/src/kernel/{session-stream-mapping.ts:9-34,events.ts:46-152}。`
- `public facade 还没有 /runtime 与 /items；workspace 仍是 metadata-first，tool-calls 仍是 first-wave stub：GET /tool-calls 返回空数组，workspace read 返回 metadata + "filesystem-core-leaf-rpc-pending"；见 workers/orchestrator-core/src/{facade/route-registry.ts:14-51,hp-absorbed-routes.ts:158-185,248-269}。`
- `设计稿存在陈旧或失真的锚点：F3 仍把主阻塞写成 compactRequired:false 硬编码，但当前 orchestration 已有 probeCompactRequired；同时文中引用了仓库内并不存在的 packages/nacp-session/src/emit-helpers.ts；见 docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md:362,388,406,582-587，对照 workers/agent-core/src/host/orchestration.ts:309-325。`

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 以 design doc、当前 workers/packages、以及 context/ 三套一手代码为主证据。 |
| 本地命令 / 测试 | `yes` | 仅执行了 code search / file view；本轮是 design review，不以 build/test 为主要证据。 |
| schema / contract 反向校验 | `yes` | 重点核对了 nacp-session 的 messages / direction matrix / session-registry / stream-event。 |
| live / deploy / preview 证据 | `n/a` | 本轮不审实现上线状态，而审设计是否贴合当前代码现实。 |
| 与上游 design / QNA 对账 | `yes` | 直接对账 HPX5/HPX6 设计稿与 README、当前实现、context 参考代码。 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | HPX5 被定义为“纯 wire-up / 不动 contract”与现状不符 | `high` | `scope-drift` | `yes` | 重写 phase 边界，承认 F5/F6/F7 含 bounded contract expansion，或把其中一部分移入 HPX6 |
| R2 | confirmation/todo/model-fallback 的接线成本被严重低估 | `high` | `delivery-gap` | `yes` | 为 HPX5 明确补一条跨 worker event bridge / single emit seam 设计，不要把问题写成“补几个 emit” |
| R3 | F3 auto-compact 章节使用了陈旧 baseline | `medium` | `docs-gap` | `no` | 改写为当前真实剩余缺口：body 透传、turn-boundary trigger、job/status emit、breaker 持久化 |
| R4 | HPX6 runtime/item 方向正确，但 truth owner 与 hydration 路径未定义 | `medium` | `platform-fitness` | `yes` | 在设计中增加 source-of-truth matrix，明确 public runtime 与 internal RuntimeConfig 的边界 |
| R5 | followup_input 与 polling 的表述存在协议漂移风险 | `medium` | `protocol-drift` | `no` | 把“{text} only / 删除全部 polling 代码”改成“first-party MVP 仅依赖 text / happy path 不再依赖 polling” |

### R1. `HPX5 被定义为“纯 wire-up / 不动 contract”与现状不符`

- **严重级别**：`high`
- **类型**：`scope-drift`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md:303-310,360-366,419-444,635-645`
  - `workers/orchestrator-core/src/hp-absorbed-routes.ts:158-185,248-269`
  - `workers/orchestrator-core/src/facade/routes/session-files.ts:59-76,152-177`
- **为什么重要**：
  - 该文档最核心的组织原则就是“HPX5 = 不动 contract 的低风险接线，HPX6 = contract 扩展”。一旦这个边界本身不准，后续 action-plan、review gate、测试线路都会被带偏。
  - F5 `workspace bytes GET`、F6 `tool-calls detail + ledger`、F7 `/start.first_event_seq` 与新增 consistency checker，都已经不再是“只接现成 schema 的线”。
- **审查判断**：
  - 当前仓库没有 `GET /sessions/{id}/workspace/files/{*path}/content`；现有 workspace read 仍返回 metadata，并明确 `content_source: "filesystem-core-leaf-rpc-pending"`。
  - 当前 `GET /sessions/{id}/tool-calls` 仍返回 `tool_calls: []` 的 first-wave stub；这不是补 emitter，而是新增真实 read model。
  - 因此“HPX5 不引入任何新 contract”这一总论必须撤回或收窄。
- **建议修法**：
  - 二选一：
    1. **保留两阶段，但重写 HPX5 定义**：改成“schema-frozen wire-up + bounded public surface completion”，显式承认 F5/F6/F7 会改 public contract；
    2. **保持 HPX5 纯 wire-up**：把 F5/F6 与会引入新字段/新文档 helper 的部分并入 HPX6。

### R2. `confirmation/todo/model-fallback 的接线成本被严重低估`

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `packages/nacp-session/src/{messages.ts:414-418,type-direction-matrix.ts:37-43,session-registry.ts:23-40,41-53,55-69,113-163,stream-event.ts:139-179}`
  - `workers/agent-core/src/kernel/{session-stream-mapping.ts:9-34,events.ts:46-152}`
  - `workers/orchestrator-core/src/{confirmation-control-plane.ts:96-131,221-260,todo-control-plane.ts:79-258}`
  - `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md:383-399,388,410-417`
- **为什么重要**：
  - 现在缺的不是“schema 没注册”，而是 **runtime live path 不经过这些新家族**。如果设计不把这个讲清楚，HPX5 很容易被误排成 façade 层小 patch，最后发现 kernel / DO attach buffer / schema validate / replay 一整串都要动。
  - 文中还引用了不存在的 `packages/nacp-session/src/emit-helpers.ts`，这说明当前设计没有落在真实 owner-file 上。
- **审查判断**：
  - confirmation/todos 在协议层已 frozen，但 agent-core 当前 live push 仍只有 9-kind。
  - model.fallback 虽在 `stream-event.ts` 里有 schema，但 `kernel/events.ts` 并不会生成它，`user-do/message-runtime.ts` 关闭 turn 时仍固定写 `fallback_used: false, fallback_reason: null`。
  - 所以 HPX5 需要的是 **补 event bridge 设计**，不是“把 row write 后 emit 一下”。
- **建议修法**：
  - 在设计稿中增加一条显式子章节：`single emit seam / replay seam`。
  - 明确 owner files：至少涉及 `workers/agent-core/src/kernel/*`、`workers/agent-core/src/host/do/session-do/runtime-assembly.ts`、`workers/orchestrator-core/src/user-do/*`、以及 session replay / ack helper。
  - 把不存在的 helper 引用替换为真实 seam，避免 action-plan 落空。

### R3. `F3 auto-compact 章节使用了陈旧 baseline`

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md:362,406,582-584`
  - `workers/agent-core/src/host/orchestration.ts:309-325,451-460`
  - `workers/orchestrator-core/src/facade/routes/session-context.ts:103-114`
- **为什么重要**：
  - 设计评审最怕“打昨天的问题”。如果 baseline 都写旧了，phase 的工程量评估和风险判断就会偏。
  - 当前真正未完成的是 compact body 透传、公共路由语义、turn-boundary 触发条件、以及 compact.notify / job 状态的完整链路，而不是简单的 hardcode removal。
- **审查判断**：
  - `runStepLoop()` 已经通过 `probeCompactRequired()` 动态探测压缩需要；设计稿再把它写成主要 blocker，已不准确。
  - 但 façade 侧的 `/context/compact` 仍没有把 body 传给 context-core，这一缺口是真实存在的。
- **建议修法**：
  - 把 F3 改写成“收口已存在的 compact probe 到 public control plane”，并把剩余 gap 明确为：
    1. body 字段透传；
    2. turn-boundary only trigger；
    3. durable compact.notify emit；
    4. breaker / retry 的持久化与审计。

### R4. `HPX6 runtime/item 方向正确，但 truth owner 与 hydration 路径未定义`

- **严重级别**：`medium`
- **类型**：`platform-fitness`
- **是否 blocker**：`yes`
- **事实依据**：
  - `README.md:3-4,17-24,43-44,175-176,202-208`
  - `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md:257-269,313-320,455-460`
  - `workers/agent-core/src/host/env.ts:186-209`
  - `workers/orchestrator-core/src/facade/route-registry.ts:14-51`
  - `context/codex/sdk/typescript/src/{events.ts:42-80,items.ts:9-127,threadOptions.ts:1-20,thread.ts:77-95}`
  - `context/claude-code/types/permissions.ts:54-79`
  - `context/gemini-cli/packages/core/src/{confirmation-bus/types.ts:18-79,scheduler/scheduler.ts:123-131,166-184,scheduler/confirmation.ts:52-103,162-175}`
- **为什么重要**：
  - README 定位的是 Cloudflare-native durable runtime，而不是 local CLI 克隆；因此 HPX6 做 runtime object 和 item projection 是合理的。
  - 但如果不明确 truth owner，HPX6 很容易同时发明：public runtime JSON、User DO session state、agent-core internal RuntimeConfig、以及 item cache 四份 truth。
- **审查判断**：
  - `RuntimeConfig` 现在只是 agent-core 的 infra knobs，不是用户会话设置对象。
  - Codex / Claude Code / Gemini CLI 的一手代码都支持“对象化 permission/runtime/item”，但它们也都有明确的内部 owner：Codex 走 exec options + item/event model；Claude Code 走 permission rule objects；Gemini 走 scheduler + confirmation bus。
  - nano-agent 设计稿现在只有“要什么”，没有把“放哪一层、谁 hydrate、谁回放”讲完整。
- **建议修法**：
  - 在设计稿补一张 **source-of-truth matrix**：
    1. `runtime` public object 存哪张表/哪列；
    2. User DO attach 时如何 hydrate 到 agent-core；
    3. internal `RuntimeConfig` 与 public `runtime` 的翻译边界；
    4. item 各 kind 的投影来源：D1 row、stream ledger、workspace metadata、tool ledger 各自对应什么。

### R5. `followup_input 与 polling 的表述存在协议漂移风险`

- **严重级别**：`medium`
- **类型**：`protocol-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md:257,289,372,390,446-453,635`
  - `packages/nacp-session/src/messages.ts:110-127`
  - `workers/agent-core/src/host/http-controller.ts:219-234`
  - `workers/agent-core/src/host/do/session-do/ws-runtime.ts:164-183`
  - `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md:323-326`
- **为什么重要**：
  - protocol 已经 frozen，就不应该被设计文档无意中“缩回去”。
  - 同一份文档里既说 polling fallback 永久保留，又说前端可以删除全部 polling 代码，会误导后续 docs 与 client cookbook。
- **审查判断**：
  - `session.followup_input` 现在不是只有 `{text}`；还支持 `context_ref / stream_seq / model_id / reasoning / parts`，而且 agent-core HTTP ingress 已经会转发这些字段。
  - 因此 HPX6 可以把 first-party MVP 写成“只依赖 text”，但不应该把冻结协议写成“text only”。
- **建议修法**：
  - 把 F8 改成：`公开已有 frozen shape；首版前端只依赖 text，其他字段保留为 advanced surface。`
  - 把“前端可以删除全部 polling fallback 代码”统一改成：`happy path 不再依赖 polling；polling 继续保留为 reconcile fallback。`

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | confirmation WS emitter wire-up | `partial` | 方向对，但当前缺的是 single emit seam / replay seam，不是 façade 小 patch。 |
| S2 | WriteTodos capability + WS emitter | `partial` | 目标成立，但 agent-core 侧 capability contract 与 live emitter owner 未定义。 |
| S3 | auto-compact runtime trigger | `stale` | 章节把已修过的 compact probe 仍写成主 blocker，剩余缺口描述失焦。 |
| S4 | model.fallback WS emitter | `partial` | schema 与 durable columns 已有，但 live runtime 仍未发帧。 |
| S5 | workspace bytes GET | `missing` | 这是新增 public bytes route，不应被称作纯 wire-up；当前 public surface 仍是 metadata-first。 |
| S6 | tool-calls 真实化 ledger | `missing` | 当前 `/tool-calls` 仍是 stub；设计对 ledger truth owner、表与 detail 路径锚定不足。 |
| S7 | 文档断点修复 | `partial` | 需要做，但应区分“文档对齐”与“新增 contract/helper/script”。 |
| S8 | followup_input WS frame | `partial` | phase 放置正确，但 `{text} only` 会误收窄已冻结 shape。 |
| S9 | runtime config object | `partial` | 产品方向合理，但 storage / hydration / precedence 未讲清。 |
| S10 | per-tool / per-pattern permission rules | `done` | 与 Claude Code 的对象化 permission rule 心智一致，也贴合 README 的 typed capability runtime。 |
| S11 | retry executor | `done` | 明确承接当前 first-wave ack，phase 放置正确。 |
| S12 | restore executor | `done` | 与现有 restore job substrate 对齐，phase 放置正确。 |
| S13 | fork executor | `done` | 与现有 pending-executor fork substrate 对齐，phase 放置正确。 |
| S14 | item projection 层 | `partial` | 方向正确，但缺“每类 item 从何处投影”的 source map。 |
| S15 | file_change item 与 emitter | `partial` | 有价值，但前提是先补 workspace bytes / write observability / item source map。 |

### 3.1 对齐结论

- **done**: `4`
- **partial**: `8`
- **missing**: `2`
- **stale**: `1`
- **out-of-scope-by-design**: `0`

> 这份设计更像“方向和 phase 粗切已经成形，但 freeze 前还需要把 phase 边界、truth owner、以及几处陈旧基线纠正掉”，而不是可以直接下发 action-plan 的最终冻结版。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | 不引入完整 Codex ThreadOptions 全字段 | `遵守` | 只取 5 字段最小集是合理收敛，符合 README 的非本地宿主边界。 |
| O2 | 不引入 streaming tool execution | `遵守` | Claude Code 确有 StreamingToolExecutor，但当前 nano-agent 不应在本阶段追平它。 |
| O3 | 不做跨 conversation fork | `遵守` | 设计与当前 same-conversation fork substrate 一致。 |
| O4 | followup_input rich optional fields | `误报风险` | 设计若把它写成“协议只支持 text”会误伤当前 frozen shape；正确表述应是“首版 client 只依赖 text”。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. `重写 HPX5 的 phase 定义，承认 F5/F6/F7 不是纯 wire-up，或把它们迁入 HPX6；不能继续维持“HPX5 不动 contract”的总论。`
  2. `在文档中补齐 event/runtime truth-owner 设计：确认/待办/模型回退的 live emit seam、public runtime 的存储与 hydrate 路径、item projection 的 source map。`
- **可以后续跟进的 non-blocking follow-up**：
  1. `把 F3 的 baseline 改成当前真实剩余缺口，删掉对已修旧问题与不存在 helper 的引用。`
  2. `把 followup_input 与 polling 的措辞改成“不收窄 frozen protocol、不夸大 happy path 收口”。`
- **建议的二次审查方式**：`same reviewer rereview`
- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。
