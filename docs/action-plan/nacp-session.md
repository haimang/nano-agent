# Nano-Agent 行动计划 — NACP-Session v1

> 服务业务簇: `NACP (Nano-Agent Communication Protocol)`
> 计划对象: `@nano-agent/nacp-session` — 协议家族中的 client ↔ session DO WebSocket profile
> 类型: `new`
> 作者: `GPT-5.4`
> 时间: `2026-04-16`
> 文件位置: `packages/nacp-session/`（主仓 monorepo 内的 workspace package）
> 关联设计 / 调研文档:
> - `docs/nacp-by-opus.md`（NACP v2 主设计文档）
> - `docs/nacp-reviewed-by-GPT.md`（对 Session blind spot 的 critique 来源）
> - `docs/action-plan/nacp-core.md`（已完成的 Core 地基）
> - `docs/design/hooks-by-GPT.md`（Hook → `session.stream.event` 映射）
> - `docs/design/llm-wrapper-by-GPT.md`（LLM stream → Session stream 映射）
> - `README.md` §1 / §3 / §4 / §5（WebSocket-first、主仓 monorepo、workspace 协作）
> - 参考代码：`packages/nacp-core/`、`context/smcp/`、`context/safe/`
> 文档状态: `draft`

---

## 0. 执行背景与目标

`@nano-agent/nacp-core` 已经完成收口，它解决的是 **worker / DO / queue / audit** 之间的内部 envelope 与 transport contract；但它没有解决 nano-agent 作为 **WebSocket-first、DO-centered、可断线恢复的会话系统** 最关键的另一半问题：

> **client ↔ session DO 的 session profile 到底长什么样。**

这不是一个“补一个 websocket.ts”就能结束的工作。`NACP-Session` 必须把之前在 review 里指出的几个核心断点真正落地：

1. `stream_seq / replay_from / last_seen_seq / stream_id / ack_required / delivery_mode` 这些字段如何组成**可恢复事件流**；
2. client frame 与 Core internal message 的边界如何切开，尤其是 **authority 必须 server-stamped，不能由 client author**；
3. `tool.call.progress`、hook 可观测事件、未来 LLM delta 等 server-push 内容，如何统一进入 **`session.stream.event`**；
4. DO hibernation / WebSocket reconnect / replay buffer / heartbeat / ack 这些能力，如何变成**可测试、可复用、可被下游实现导入的运行时助手**。

- **服务业务簇**：`NACP Protocol Family v1`
- **计划对象**：`@nano-agent/nacp-session` 包（session message schema + replay/resume contract + WebSocket profile helpers + session stream adapters）
- **本次计划解决的问题**：
  - nano-agent 目前只有 Core internal contract，缺少 client ↔ session DO 的稳定 wire profile → WebSocket 恢复语义无法冻结
  - Hook / Tool progress / 未来 LLM delta 都需要一个统一的 server-push channel → 否则各子系统会各推各的事件 shape
  - Core 已经把 `session.*` 从内部协议里剥离出来 → 现在必须有一份独立 action-plan 把它们正式落到实现层
  - README 现明确 `packages/*` 由主仓 monorepo 统一跟踪 → `@nano-agent/nacp-session` 必须按稳定 workspace package / protocol package 的方式规划
- **本次计划的直接产出**：
  - `@nano-agent/nacp-session` 包（可 `pnpm install` 的 workspace 依赖，由主仓统一跟踪）
  - **完整的 Session profile schema + runtime helpers**（message schema / replay buffer / ack policy / heartbeat / websocket adapter）
  - **针对 reconnect / replay / ack / progress stream 的测试体系**
  - **可导出的 JSON Schema**（`dist/nacp-session.schema.json`）与注册表文档（`docs/nacp-session-registry.md`）

---

## 1. 执行综述

### 1.1 总体执行方式

本 action-plan 分 **6 个 Phase**，执行策略是 **“先协议后恢复语义，先恢复语义后 transport，先 transport 再 adapter”**：

1. 先把 **Session profile 的消息集合与 stream event catalog** 冻结，避免后续实现时反复改字段；
2. 再把 **authority 戳印、client/server frame 边界、role gate、状态约束** 固化为独立 helper，确保 Session 不会把 Core 的信任模型搞乱；
3. 然后实现 **replay / resume / ack / heartbeat** 这套真正决定“会不会丢事件”的 runtime helper；
4. 再接 **WebSocket profile / DO integration contract / progress forwarding**；
5. 最后补齐 **hooks / tool / llm 的 Session adapter seam**、测试、schema 导出、文档与主仓协作收尾。

**刻意推迟**的东西：

- 完整 client SDK / UI / TUI
- ACP bridge
- HTTP SSE fallback / provider WebSocket bridge
- 多客户端协作编辑式 attach 模型
- 依赖真实部署环境的复杂跨 Worker / 跨 DO e2e

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | **Session 协议骨架与消息 schema** | M | package 骨架、7 个 Session 消息 schema、`session.stream.event` 最小 catalog、版本与 registry 常量 | - |
| Phase 2 | **Ingress / Egress 归一化与边界校验** | M | client frame authority omission、server-stamped normalize、role requirements、session 层状态约束 | Phase 1 |
| Phase 3 | **Replay / Resume / Ack / Heartbeat 运行时** | M | ring buffer、resume policy、ack window、heartbeat timeout、Session error registry | Phase 1, Phase 2 |
| Phase 4 | **WebSocket Profile + DO 集成助手** | L | websocket helper、attach/resume contract、replay 发送、progress forwarding seam | Phase 2, Phase 3 |
| Phase 5 | **Session Stream Adapter 与 Redaction** | M | hook / tool / llm / compact / system 到 `session.stream.event` 的映射与 redaction builder | Phase 1, Phase 4 |
| Phase 6 | **测试、Schema 导出、文档与主仓协作收尾** | M | unit + integration tests、schema export、registry doc、README、主仓协作约定收口 | Phase 1-5 |

**工作量估算口径**：

- XS = 0.5 天；S = 1–2 天；M = 3–5 天；L = 6–8 天；XL = > 8 天（应拆分）
- 总估算：**M+M+M+L+M+M = 约 22–30 天**（单人 full-time）

### 1.3 Phase 说明

1. **Phase 1 — Session 协议骨架与消息 schema**
   - **核心目标**：冻结 `session.start / session.resume / session.cancel / session.end / session.stream.event / session.stream.ack / session.heartbeat` 七个消息的 schema、`NACP_SESSION_WS_SUBPROTOCOL`、`SessionStreamEventBody` 的最小 discriminated union
   - **为什么先做**：Session 是下游所有 client-facing 事件的总出口，只有把 schema 钉死，后面的 replay / adapter 才不会乱长

2. **Phase 2 — Ingress / Egress 归一化与边界校验**
   - **核心目标**：实现 “client frame 可省略 authority、ingress 负责 server-stamp、进入运行时后必须是可信 Session message” 的 normalize 流程，并建立 `client / session / ingress` 的 per-role requirements
   - **为什么放在这里**：Session profile 的核心不是 WebSocket API，而是**信任边界**；这一步必须在 replay/runtime 前完成

3. **Phase 3 — Replay / Resume / Ack / Heartbeat 运行时**
   - **核心目标**：把 `stream_seq / replay_from / last_seen_seq / delivery_mode / ack_required` 真正落到 ring buffer、resume policy、ack window、heartbeat deadline 上
   - **为什么放在这里**：review 明确指出“DO hibernation 不等于恢复协议”；这是 `nacp-session` 最关键的运行时骨架

4. **Phase 4 — WebSocket Profile + DO 集成助手**
   - **核心目标**：提供 session DO 侧可直接复用的 `websocket.ts` / attach-resume helper / replay send helper / external progress forwarding seam
   - **为什么放在这里**：只有 replay/ack 规则稳定后，WebSocket send/receive 才能不写成一堆 if/else

5. **Phase 5 — Session Stream Adapter 与 Redaction**
   - **核心目标**：统一 hook / tool / llm / compact / system 的 client-facing event shape，并消费 Core `redaction_hint`
   - **为什么放在这里**：Session profile 的价值不只是连接不断，而是**所有 server-push 都走同一事件层**

6. **Phase 6 — 测试、Schema 导出、文档与主仓协作收尾**
   - **核心目标**：让 `@nano-agent/nacp-session` 真正成为一个可独立追踪、可被下游导入、可被 review 收口的 package
   - **为什么放在这里**：只有前面五个 Phase 稳定后，schema 导出、registry 文档、README 与 integration case 才不会反复重写

### 1.4 执行策略说明

- **执行顺序原则**：**“message schema → normalize/stamp → replay semantics → websocket helper → adapters → docs/tests”**
- **风险控制原则**：Session 侧所有涉及 **丢事件 / 重放 / authority / replay out-of-range / ack mismatch** 的路径都必须有显式测试，不接受“靠运行时经验”兜底
- **测试推进原则**：
  - 每个 Phase 开始前先列出 test skeleton
  - Phase 3/4 的 replay 与 reconnect 测试必须先有失败用例，再补 runtime helper
  - 对 `replay.ts` / `websocket.ts` / `frame.ts` / `redaction.ts` 这些高风险模块，目标覆盖率 ≥ 90%
  - Integration tests 至少覆盖：`start → stream → disconnect → resume → replay` 与 `ack_required` 两条主路径
- **文档同步原则**：
  - 每个 Phase 结束后回填 `docs/nacp-by-opus.md` 的 Session 相关实施路线图
  - Phase 5 完成时回填 `docs/design/hooks-by-GPT.md` 与 `docs/design/llm-wrapper-by-GPT.md` 中对 `session.stream.event` 的依赖说明
  - 所有 public API / event kind 变更必须同步到 `packages/nacp-session/README.md`

### 1.5 本次 action-plan 影响目录树

```text
packages/nacp-session/
├── src/
│   ├── version.ts                  [Phase 1]     Session protocol version + WS subprotocol
│   ├── messages.ts                 [Phase 1]     7 个 Session 消息 schema
│   ├── stream-event.ts             [Phase 1,5]   SessionStreamEventBody + v1 kinds
│   ├── registry.ts                 [Phase 1,2]   SESSION_MESSAGE_TYPES / ROLE_REQUIREMENTS
│   ├── errors.ts                   [Phase 1,3]   Session error types + registry
│   ├── frame.ts                    [Phase 2]     client/server frame schema + normalize
│   ├── ingress.ts                  [Phase 2]     authority stamping + trust boundary helper
│   ├── replay.ts                   [Phase 3]     replay buffer + out-of-range policy
│   ├── delivery.ts                 [Phase 3]     delivery_mode / ack_required / ack window
│   ├── heartbeat.ts                [Phase 3]     heartbeat timeout / liveness helper
│   ├── websocket.ts                [Phase 4]     WS profile helper + replay send
│   ├── redaction.ts                [Phase 5]     redaction_hint → redacted frame
│   ├── adapters/
│   │   ├── tool.ts                 [Phase 5]     tool progress/result → stream.event
│   │   ├── hook.ts                 [Phase 5]     hook observation → stream.event
│   │   ├── llm.ts                  [Phase 5]     normalized model delta → stream.event（接口优先）
│   │   ├── compact.ts              [Phase 5]     compact lifecycle → stream.event
│   │   └── system.ts               [Phase 5]     session/system/error → stream.event
│   └── index.ts                    [Phase 1-6]   公开导出面
├── test/
│   ├── messages.test.ts            [Phase 1]
│   ├── frame.test.ts               [Phase 2]
│   ├── ingress.test.ts             [Phase 2]
│   ├── replay.test.ts              [Phase 3]
│   ├── delivery.test.ts            [Phase 3]
│   ├── heartbeat.test.ts           [Phase 3]
│   ├── websocket.test.ts           [Phase 4]
│   ├── redaction.test.ts           [Phase 5]
│   ├── adapters/*.test.ts          [Phase 5]
│   └── integration/
│       ├── reconnect-replay.test.ts [Phase 6]
│       ├── ack-window.test.ts       [Phase 6]
│       └── heartbeat-timeout.test.ts [Phase 6]
├── scripts/
│   ├── export-schema.ts            [Phase 6]
│   └── gen-registry-doc.ts         [Phase 6]
├── dist/
│   └── nacp-session.schema.json    [Phase 6, 生成物]
├── package.json                    [Phase 1]
├── tsconfig.json                   [Phase 1]
├── README.md                       [Phase 1-6]
├── CHANGELOG.md                    [Phase 1-6]
└── .gitignore                      [Phase 6]     workspace package 忽略规则
```

**对主仓文档的反向影响**：

```text
docs/
├── action-plan/
│   ├── nacp-core.md
│   └── nacp-session.md                 [本文件]
├── nacp-by-opus.md                     [Session 路线图与状态回填]
├── nacp-session-registry.md            [Phase 6 生成物]
├── design/hooks-by-GPT.md              [Phase 5 回填 NACP-Session 映射]
├── design/llm-wrapper-by-GPT.md        [Phase 5 回填 Session stream 对齐]
└── code-review/                        [执行后 code review 记录]
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** `@nano-agent/nacp-session` 独立 package 骨架（`package.json` / `tsconfig.json` / `README.md` / `CHANGELOG.md` / `src/index.ts`）
- **[S2]** Session WebSocket subprotocol 常量：`nacp-session.v1`
- **[S3]** 7 个 Session 消息 schema：
  - `session.start`
  - `session.resume`
  - `session.cancel`
  - `session.end`
  - `session.stream.event`
  - `session.stream.ack`
  - `session.heartbeat`
- **[S4]** `SessionStreamEventBody` 的 v1 discriminated union 与最小事件 catalog
- **[S5]** client → server frame 的“authority 可省略 / server-stamped normalize” helper
- **[S6]** server → client frame 的标准化输出 helper
- **[S7]** `SESSION_MESSAGE_TYPES` 与 Session profile 的 per-role requirements（至少覆盖 `client / session / ingress`）
- **[S8]** Session profile 的状态约束 helper：`unattached / attached / turn_running / ended` 下哪些 Session 消息合法
- **[S9]** replay buffer helper：按 `stream_id` 维护 ring buffer，支持 `replay_from`
- **[S10]** `delivery_mode` / `ack_required` / `last_seen_seq` / ack window helper
- **[S11]** `NACP_REPLAY_OUT_OF_RANGE` 与其他 Session-specific error code/类型
- **[S12]** heartbeat / liveness helper（保活、超时、恢复判断）
- **[S13]** websocket helper：attach / resume / send / replay / close 的运行时助手
- **[S14]** 将外部 progress / hook / future llm delta 统一转为 `session.stream.event` 的 adapter seam
- **[S15]** `redaction_hint` 消费器：把 Core 消息转 Session frame 时做 redaction
- **[S16]** unit tests：messages / frame / ingress / replay / delivery / heartbeat / websocket / adapters
- **[S17]** integration tests：至少覆盖 reconnect/replay、ack window、heartbeat timeout 三条路径
- **[S18]** `scripts/export-schema.ts`：导出 `dist/nacp-session.schema.json`
- **[S19]** `scripts/gen-registry-doc.ts`：生成 `docs/nacp-session-registry.md`
- **[S20]** `packages/nacp-session/` 主仓 workspace 跟踪约定与 README 说明

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 完整 session DO 业务实现（agent loop / tool orchestration / prompt handling 本体）
- **[O2]** client SDK / browser UI / CLI TUI
- **[O3]** ACP bridge
- **[O4]** HTTP SSE fallback / provider realtime transport
- **[O5]** 多 DO 跨实例 resume / session migration
- **[O6]** 多客户端并发 attach 的复杂协作模型
- **[O7]** 全量 LLM event taxonomy（只定义 Session stream 的基础 contract 与 adapter seam）
- **[O8]** 端到端加密 / 自定义 WebSocket 压缩协议
- **[O9]** session metrics / analytics / observability pipeline 本体
- **[O10]** skill registry / llm registry / database schema
- **[O11]** 与真实 Cloudflare deployment 完全绑定的生产级 e2e（如需，可在执行中 re-baseline 为 deployment suite）

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| `session.stream.event` 作为唯一 server-push 通道 | `in-scope` | 这是 Session profile 的核心价值，不可再拆散 | 不重评，结构性原则 |
| client frame 省略 `authority` | `in-scope` | server-stamped 是 review 已冻结的原则 | 不重评 |
| `session.start` 是否带首条用户输入 | `depends-on-decision` | 会影响 message body 与 end-to-end 路径 | Phase 1 前由业主确认 |
| 多客户端同时 attach 同一 session | `out-of-scope` | replay / ack / heartbeat 复杂度会指数上升 | 真实 observer 需求出现时 |
| 将 LLM delta kinds 全部冻结 | `defer` | 需等 wrapper 的 normalized event 稳定 | `llm-wrapper` action-plan 执行时 |
| 真实 WebSocket deployment 集成测试 | `in-scope`，但可 `deferred-to-deployment` | Session profile 非常依赖 reconnect 语义；如缺环境，可正式 re-baseline | Phase 6 执行期 |
| 反向 progress RPC fallback（tool worker → session DO） | `defer` | 先做 ReadableStream 主路径，reverse RPC 做 seam | fake bash / long-running capability 开始时 |

---

## 3. 业务工作总表

> 编号规范：`P{phase}-{seq:02}`，共 24 个工作项

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | package 骨架 | `add` | `package.json`、`tsconfig.json`、`README.md`、`CHANGELOG.md` | 建出可独立跟踪的 session package | low |
| P1-02 | Phase 1 | 版本与子协议常量 | `add` | `src/version.ts` | 冻结 `nacp-session.v1` 与版本导出 | low |
| P1-03 | Phase 1 | 7 个 Session 消息 schema | `add` | `src/messages.ts` | 冻结 Session profile 的消息面 | medium |
| P1-04 | Phase 1 | stream event catalog | `add` | `src/stream-event.ts` | 建出 `session.stream.event` 的最小 discriminated union | medium |
| P1-05 | Phase 1 | registry 与错误骨架 | `add` | `src/registry.ts`、`src/errors.ts` | 建立 Session role / error 的基础表 | medium |
| P2-01 | Phase 2 | client frame normalize | `add` | `src/frame.ts` | client frame 进入运行时前统一归一化 | high |
| P2-02 | Phase 2 | ingress authority stamping | `add` | `src/ingress.ts` | authority 只由 ingress 注入，不由 client author | high |
| P2-03 | Phase 2 | Session role requirements | `add` | `src/registry.ts` | 明确 client/session/ingress 各自 producer/consumer | medium |
| P2-04 | Phase 2 | Session state gate | `add` | `src/frame.ts` 或 `src/state.ts` | 让 Session message 也有 phase-level 合法性判断 | medium |
| P3-01 | Phase 3 | replay buffer helper | `add` | `src/replay.ts` | 让 DO 能按 `stream_id` 可重放地存储事件 | high |
| P3-02 | Phase 3 | ack / delivery helper | `add` | `src/delivery.ts` | 让 `last_seen_seq` / `ack_required` 进入运行时规则 | high |
| P3-03 | Phase 3 | replay out-of-range policy | `add` | `src/replay.ts`、`src/errors.ts` | 缺口明确抛 `NACP_REPLAY_OUT_OF_RANGE` | high |
| P3-04 | Phase 3 | heartbeat / liveness helper | `add` | `src/heartbeat.ts` | 让断线 / 假活跃有统一判断 | medium |
| P4-01 | Phase 4 | websocket profile helper | `add` | `src/websocket.ts` | 建立 attach / send / replay / close 基础能力 | high |
| P4-02 | Phase 4 | DO 集成 contract | `add` | `src/websocket.ts` | 提供 session DO 可直接消费的 helper API | high |
| P4-03 | Phase 4 | replay send path | `add` | `src/websocket.ts`、`src/replay.ts` | 断线重连时能基于 buffer 重推 | high |
| P4-04 | Phase 4 | progress forwarding seam | `add` | `src/adapters/tool.ts`、`src/websocket.ts` | 把 Core/worker progress 安全转成 Session push | medium |
| P5-01 | Phase 5 | redaction builder | `add` | `src/redaction.ts` | `redaction_hint` 真正影响对 client 的输出 | high |
| P5-02 | Phase 5 | hook adapter | `add` | `src/adapters/hook.ts` | hooks 事件统一映射为 `session.stream.event` | medium |
| P5-03 | Phase 5 | tool / compact / system adapters | `add` | `src/adapters/tool.ts`、`compact.ts`、`system.ts` | 形成稳定的 server-push 事件集 | medium |
| P5-04 | Phase 5 | llm adapter seam | `add` | `src/adapters/llm.ts` | 给 wrapper 预留 normalized delta → Session event 的接口 | medium |
| P6-01 | Phase 6 | unit test 全覆盖 | `add` | `test/*.test.ts` | 所有高风险 helper 都有单测 | high |
| P6-02 | Phase 6 | reconnect/ack/heartbeat integration | `add` | `test/integration/*.test.ts` | Session profile 的关键恢复路径被验证 | high |
| P6-03 | Phase 6 | schema/doc 生成 | `add` | `scripts/export-schema.ts`、`scripts/gen-registry-doc.ts` | 对外输出 schema 与 registry artifact | low |
| P6-04 | Phase 6 | README / 主仓 workspace / 主仓文档回填 | `update` | `README.md`、`.gitignore`、`docs/*` | 完成 package 级与主仓级协作说明 | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Session 协议骨架与消息 schema

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | package 骨架 | 创建独立 package 基础文件与导出入口 | `package.json`、`tsconfig.json`、`README.md`、`CHANGELOG.md`、`src/index.ts` | `@nano-agent/nacp-session` 可作为 workspace 包被引用 | `pnpm build` | 包结构稳定、README 写明主仓 workspace 策略 |
| P1-02 | 版本与子协议常量 | 定义 protocol version、WS subprotocol、兼容常量 | `src/version.ts` | `NACP_SESSION_VERSION` / `NACP_SESSION_WS_SUBPROTOCOL` 可统一导入 | `version.test.ts` | 常量冻结且被 README 引用 |
| P1-03 | 7 个 Session 消息 schema | 定义所有 Session message body schema 与 message family | `src/messages.ts` | Session profile 的消息面不再散落在文档里 | `messages.test.ts` | 7 个消息全可 parse / invalid case 可拒绝 |
| P1-04 | stream event catalog | 建立 `session.stream.event` v1 kinds 与 shared fields | `src/stream-event.ts` | tool / hook / llm / system 都有统一事件承载层 | `stream-event.test.ts` | union 可区分 kind 且能扩展 |
| P1-05 | registry 与错误骨架 | 建 Session message registry 与 Session error type skeleton | `src/registry.ts`、`src/errors.ts` | Session package 自己能回答“谁能发什么、会抛什么错” | `registry.test.ts` | registry 与 error code 不再依赖手写注释 |

### 4.2 Phase 2 — Ingress / Egress 归一化与边界校验

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | client frame normalize | 定义 relaxed client frame schema，并归一化为可信 Session message | `src/frame.ts` | client 可省 authority，但运行时不会接收未戳印消息 | `frame.test.ts` | normalize 后 shape 稳定、非法 frame 被拒绝 |
| P2-02 | ingress authority stamping | 提供 ingress helper，负责注入 authority / stamped metadata | `src/ingress.ts` | authority 信任边界固定由 server 掌握 | `ingress.test.ts` | client authored authority 无法直接穿透 |
| P2-03 | Session role requirements | 定义 `client / session / ingress` producer/consumer 子集 | `src/registry.ts` | Session profile 不再依赖 Core 文档补充说明 | `registry.test.ts` | role gate 能在运行时被消费 |
| P2-04 | Session state gate | 根据 phase 判断 `session.start / resume / cancel / end / ack` 的合法性 | `src/frame.ts` 或 `src/state.ts` | Session message 也有明确 sequence 规则 | `state.test.ts` | 非法转移抛 Session/Profile 级错误 |

### 4.3 Phase 3 — Replay / Resume / Ack / Heartbeat 运行时

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | replay buffer helper | 实现按 `stream_id` 维护的 ring buffer | `src/replay.ts` | DO 可维护 last-N events 用于 resume | `replay.test.ts` | append / trim / replay_from 都可验证 |
| P3-02 | ack / delivery helper | 定义 ack_required / delivery_mode / ack window 规则 | `src/delivery.ts` | best-effort 与 ack-required 语义进入代码层 | `delivery.test.ts` | ack mismatch / stale ack 均可判定 |
| P3-03 | replay out-of-range policy | 对 buffer 外的 replay 明确抛错 | `src/replay.ts`、`src/errors.ts` | client 有确定性的恢复失败信号 | `replay.test.ts` | `NACP_REPLAY_OUT_OF_RANGE` 路径可触发 |
| P3-04 | heartbeat / liveness helper | 建立 heartbeat 频率、超时与 stale connection 判断 | `src/heartbeat.ts` | attach 连接具备统一保活规则 | `heartbeat.test.ts` | timeout / stale / healthy 三类路径明确 |

### 4.4 Phase 4 — WebSocket Profile + DO 集成助手

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | websocket profile helper | 实现基本 send / close / subprotocol / serialization helper | `src/websocket.ts` | Session DO 不必从零写 WebSocket framing | `websocket.test.ts` | WS helper 可独立测试 |
| P4-02 | DO 集成 contract | 定义 attach / resume / ack / heartbeat 的 helper API | `src/websocket.ts` | Session DO 只需提供 storage/socket 抽象即可复用 | `websocket.test.ts` | helper API 边界清楚、无宿主强耦合 |
| P4-03 | replay send path | 将 replay buffer 与 websocket send 串起来 | `src/websocket.ts`、`src/replay.ts` | resume 后可按 seq 补推事件 | `reconnect-replay.test.ts` | start→disconnect→resume→补推 完整通过 |
| P4-04 | progress forwarding seam | 支持把 Core/worker progress 安全转 Session event | `src/adapters/tool.ts`、`src/websocket.ts` | progress 路径不再是文档概念，而是有 helper seam | `websocket.test.ts`、`tool-adapter.test.ts` | 可消费 `ReadableStream` 或标准 event input |

### 4.5 Phase 5 — Session Stream Adapter 与 Redaction

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | redaction builder | 消费 Core `redaction_hint` 生成 redacted event frame | `src/redaction.ts` | client 永远只看到经过 audience/redaction 处理的数据 | `redaction.test.ts` | 敏感字段确实被替换/移除 |
| P5-02 | hook adapter | 把 Hook execution record 映射到 `session.stream.event` | `src/adapters/hook.ts` | hooks-by-GPT 可直接对齐 Session 输出 | `hook-adapter.test.ts` | hook started/finished/block 等 kind 稳定 |
| P5-03 | tool / compact / system adapters | 把 tool progress/result、compact、system/error 统一映射 | `src/adapters/tool.ts`、`compact.ts`、`system.ts` | 非 LLM 事件也统一走 session stream | `tool/compact/system adapter tests` | event shape 一致、trace preserved |
| P5-04 | llm adapter seam | 为 future wrapper 暴露 normalized llm delta → stream.event API | `src/adapters/llm.ts` | wrapper 不需要自己发明 client event shape | `llm-adapter.test.ts` | 只冻结 seam，不绑定 provider 细节 |

### 4.6 Phase 6 — 测试、Schema 导出、文档与主仓协作收尾

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P6-01 | unit test 全覆盖 | 为每个核心 helper 建单测 | `test/*.test.ts` | Session package 的高风险路径全部有 regression guard | `pnpm test` | 核心 helper 覆盖充分 |
| P6-02 | reconnect/ack/heartbeat integration | 补三条最关键 integration path | `test/integration/*.test.ts` | Session 的恢复语义被真实模拟验证 | `pnpm test:integration` | reconnect/replay/ack/heartbeat 均通过 |
| P6-03 | schema/doc 生成 | 导出 JSON Schema 与 registry Markdown | `scripts/export-schema.ts`、`scripts/gen-registry-doc.ts` | 非 TS 使用方可消费 schema artifact | `pnpm build:schema`、`pnpm build:docs` | 生成物稳定且可追踪 |
| P6-04 | README / 主仓 workspace / 主仓文档回填 | 更新 package README、主仓 workspace 约定、主仓文档关联 | `README.md`、`.gitignore`、`docs/*` | Session package 的协作方式对外清楚 | 文档检查 | 主仓与 package 边界清楚、可 review |

---

## 5. Phase 详情

### 5.1 Phase 1 — Session 协议骨架与消息 schema

- **Phase 目标**：冻结 Session profile 的最小公共语言
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
  - `P1-03`
  - `P1-04`
  - `P1-05`
- **本 Phase 新增文件**：
  - `packages/nacp-session/package.json`
  - `packages/nacp-session/tsconfig.json`
  - `packages/nacp-session/src/version.ts`
  - `packages/nacp-session/src/messages.ts`
  - `packages/nacp-session/src/stream-event.ts`
  - `packages/nacp-session/src/registry.ts`
  - `packages/nacp-session/src/errors.ts`
- **本 Phase 修改文件**：
  - `packages/nacp-session/src/index.ts`
  - `packages/nacp-session/README.md`
- **具体功能预期**：
  1. Session 的 7 个 message type 不再只是文档条目，而是可 parse 的 schema
  2. `session.stream.event` 的 shared fields 与最小 kind catalog 被正式冻结
  3. Session package 自己拥有 registry / error / version 常量，不依赖 Core README 补充说明
- **具体测试安排**：
  - **单测**：message parse、invalid body、kind discriminated union
  - **集成测试**：无
  - **回归测试**：version / registry snapshot
  - **手动验证**：检查 README 的 message table 与 schema 输出一致
- **收口标准**：
  - 7 个消息 schema 均能成功 parse 合法输入
  - `session.stream.event` 的 kind union 可扩展且能拒绝非法 kind
  - package build / typecheck 基础通过
- **本 Phase 风险提醒**：
  - 过早把 event kinds 定太细，会拖累后续 wrapper / hooks
  - `session.start` body 是否包含首个 prompt 尚未完全冻结

### 5.2 Phase 2 — Ingress / Egress 归一化与边界校验

- **Phase 目标**：把 Session 的信任边界写成代码
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
  - `P2-03`
  - `P2-04`
- **本 Phase 新增文件**：
  - `packages/nacp-session/src/frame.ts`
  - `packages/nacp-session/src/ingress.ts`
- **本 Phase 修改文件**：
  - `packages/nacp-session/src/registry.ts`
  - `packages/nacp-session/src/messages.ts`
- **具体功能预期**：
  1. client frame 默认不能自带可信 authority；authority 只能由 ingress 注入
  2. Session profile 有自己的 role requirements 与 state gate
  3. normalize 之后的 Session message 形状稳定，可直接交给 session DO 运行时
- **具体测试安排**：
  - **单测**：authority omission、stamping、forged authority rejection、role gate、state gate
  - **集成测试**：无
  - **回归测试**：非法 phase 转移
  - **手动验证**：用样例 JSON 走完整 normalize 流程
- **收口标准**：
  - forged authority 不可能直接进入可信 path
  - `session.start/resume/cancel/end/ack` 的 phase-level legality 有测试覆盖
  - `client / session / ingress` 的消息职责边界清楚
- **本 Phase 风险提醒**：
  - Session 与 Core 的 phase 语义重复实现时，容易 drift

### 5.3 Phase 3 — Replay / Resume / Ack / Heartbeat 运行时

- **Phase 目标**：把 review 里指出的“恢复协议缺口”真正补上
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
  - `P3-03`
  - `P3-04`
- **本 Phase 新增文件**：
  - `packages/nacp-session/src/replay.ts`
  - `packages/nacp-session/src/delivery.ts`
  - `packages/nacp-session/src/heartbeat.ts`
- **本 Phase 修改文件**：
  - `packages/nacp-session/src/errors.ts`
  - `packages/nacp-session/src/messages.ts`
- **具体功能预期**：
  1. Session DO 可按 `stream_id` 维护 replay buffer 并支持 `replay_from`
  2. `last_seen_seq` / `ack_required` / `delivery_mode` 不只是字段，而是运行时规则
  3. heartbeat 可判断 healthy / stale / timeout
- **具体测试安排**：
  - **单测**：append/trim/replay、out-of-range、ack window、heartbeat timeout
  - **集成测试**：可用 fake socket + fake storage 进行小范围模拟
  - **回归测试**：stale ack / duplicate ack / missing stream
  - **手动验证**：手推 seq 序列，确认 resume 结果
- **收口标准**：
  - replay buffer 能稳定补发 last-N events
  - buffer 外 replay 会抛确定性错误
  - ack/heartbeat 的状态机不互相冲突
- **本 Phase 风险提醒**：
  - buffer 策略与 storage 成本容易互相牵制
  - ack 规则过复杂会让 client 负担过高

### 5.4 Phase 4 — WebSocket Profile + DO 集成助手

- **Phase 目标**：让 session DO 真正有一套可复用的 Session WebSocket runtime helper
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
  - `P4-03`
  - `P4-04`
- **本 Phase 新增文件**：
  - `packages/nacp-session/src/websocket.ts`
- **本 Phase 修改文件**：
  - `packages/nacp-session/src/replay.ts`
  - `packages/nacp-session/src/adapters/tool.ts`
- **具体功能预期**：
  1. attach / resume / send / replay / close 都有统一 helper
  2. session DO 只需提供 storage / socket 抽象即可复用 Session runtime
  3. progress forwarding 主路径优先支持 `ReadableStream`，保留 reverse-RPC seam
- **具体测试安排**：
  - **单测**：serialization / send / close / replay helper
  - **集成测试**：fake socket reconnect / replay
  - **回归测试**：resume with stale seq / socket closed during replay
  - **手动验证**：模拟断线与重连，确认 replay 顺序
- **收口标准**：
  - 有一套最小但稳定的 websocket helper API
  - resume 后能基于 `last_seen_seq` 补推
  - progress 不需要再由每个子系统单独发明 websocket 推送逻辑
- **本 Phase 风险提醒**：
  - 若 helper API 与真实 DO 宿主耦合过紧，后续测试会很难写

### 5.5 Phase 5 — Session Stream Adapter 与 Redaction

- **Phase 目标**：把 “所有 server-push 内容” 统一到 Session event 层
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
  - `P5-03`
  - `P5-04`
- **本 Phase 新增文件**：
  - `packages/nacp-session/src/redaction.ts`
  - `packages/nacp-session/src/adapters/hook.ts`
  - `packages/nacp-session/src/adapters/tool.ts`
  - `packages/nacp-session/src/adapters/llm.ts`
  - `packages/nacp-session/src/adapters/compact.ts`
  - `packages/nacp-session/src/adapters/system.ts`
- **本 Phase 修改文件**：
  - `packages/nacp-session/src/stream-event.ts`
  - `packages/nacp-session/src/messages.ts`
- **具体功能预期**：
  1. hooks / tool progress / compact / system/error 都能生成统一 `session.stream.event`
  2. `redaction_hint` 真正参与输出构建
  3. LLM wrapper 能直接对接 adapter seam，而不用自创 client event shape
- **具体测试安排**：
  - **单测**：redaction、hook mapping、tool mapping、system mapping、llm seam
  - **集成测试**：可选 small pipeline test：tool progress → adapter → replay buffer → websocket send
  - **回归测试**：redaction drift、trace 丢失、kind 不匹配
  - **手动验证**：检查面向 client 的 JSON 输出是否足够稳定与克制
- **收口标准**：
  - 所有已知 server-push 来源都走同一 event channel
  - client-facing frame 能消费 redaction / audience 策略
  - hooks 与 llm-wrapper 文档能回填到稳定 Session contract
- **本 Phase 风险提醒**：
  - 如果 adapter 抽象过重，会把业务层过早绑死

### 5.6 Phase 6 — 测试、Schema 导出、文档与主仓协作收尾

- **Phase 目标**：把 `nacp-session` 从设计稿变成真正可执行、可审查、可独立跟踪的 package
- **本 Phase 对应编号**：
  - `P6-01`
  - `P6-02`
  - `P6-03`
  - `P6-04`
- **本 Phase 新增文件**：
  - `packages/nacp-session/test/integration/reconnect-replay.test.ts`
  - `packages/nacp-session/test/integration/ack-window.test.ts`
  - `packages/nacp-session/test/integration/heartbeat-timeout.test.ts`
  - `packages/nacp-session/scripts/export-schema.ts`
  - `packages/nacp-session/scripts/gen-registry-doc.ts`
  - `packages/nacp-session/.gitignore`
- **本 Phase 修改文件**：
  - `packages/nacp-session/README.md`
  - `docs/nacp-session-registry.md`
  - `docs/design/hooks-by-GPT.md`
  - `docs/design/llm-wrapper-by-GPT.md`
- **具体功能预期**：
  1. unit / integration / schema/doc generation 形成完整闭环
  2. `nacp-session` 的 README 与主仓文档对齐
  3. package 按 `packages/*` 主仓 workspace 策略完成协作说明
- **具体测试安排**：
  - **单测**：全模块回归
  - **集成测试**：reconnect/replay、ack、heartbeat 至少三条
  - **回归测试**：schema snapshot / registry snapshot
  - **手动验证**：一次从 `session.start` 到 `session.end` 的样例流
- **收口标准**：
  - `pnpm test`、`pnpm build`、`pnpm build:schema`、`pnpm build:docs` 均通过
  - 核心恢复路径有 integration 级验证或明确 re-baseline 记录
  - 文档、README、主仓说明与 monorepo workspace 策略一致
- **本 Phase 风险提醒**：
  - 若没有可用的 websocket test harness，integration 可能要正式 re-baseline 到 deployment suite

---

## 6. 需要业主 / 架构师回答的问题清单

### 6.1 Q/A 填写模板

#### Q1

- **影响范围**：`Phase 1 / Phase 5 / 下游 session DO 实现`
- **为什么必须确认**：`当前 message set 里没有独立的 prompt.submit；若 session.start 不带初始输入，则首个用户输入应由哪条 Session message 承担，需要在 schema 层冻结`
- **当前建议 / 倾向**：`v1 允许 session.start.body 携带 optional initial_input，用于打通最小 e2e；后续若需要多轮输入，再独立补充 session input family`
- **Q**：`session.start 是否允许携带首条用户输入？`
- **A**：在 v1 上执行你推荐的方式

#### Q2

- **影响范围**：`Phase 3 / Phase 4 / integration tests`
- **为什么必须确认**：`多客户端同时 attach 会直接改变 replay buffer、ack window、heartbeat 与 authority/connection 模型`
- **当前建议 / 倾向**：`v1 只支持单 active client attach；未来如要 observer，再作为新 action-plan 处理`
- **Q**：`同一个 session 在 v1 是否只允许一个 active WebSocket client？`
- **A**：是的，但是在后续，我们要考虑租户状态。可以使用websocket的广播功能，建立 host 和 guest 的关系。允许 agent session 可以广播出去，甚至引入多人参与

#### Q3

- **影响范围**：`Phase 3 / Phase 4 / client 行为复杂度`
- **为什么必须确认**：`delivery_mode 过多会让 replay/ack 心智变重；过少又可能覆盖不了关键事件`
- **当前建议 / 倾向**：`v1 仅做两档：best-effort 与 ack-required；不再引入第三种“半持久”模式`
- **Q**：`v1 的 delivery_mode 是否只冻结为两档（best-effort / ack-required）？`
- **A**：在 v1 上执行你推荐的方式

#### Q4

- **影响范围**：`Phase 3 / Phase 4 / storage 成本与 hibernation`
- **为什么必须确认**：`buffer 保留条数与持久化策略直接影响 replay 成功率与 DO storage 成本`
- **当前建议 / 倾向**：`默认每个 stream_id 保留最近 200 条；热路径用内存，休眠恢复靠 DO storage checkpoint`
- **Q**：`replay buffer 的默认保留上限与持久化策略是否接受“last 200 + DO storage checkpoint”方案？`
- **A**：接受

### 6.2 问题整理建议

- 以上四个问题里，**Q1/Q2** 会直接改变 schema 与 runtime 路径，应优先拍板
- 若业主暂时不想拍板，可按“当前建议 / 倾向”先执行，并在 Phase 1 或 Phase 3 结束时再 review

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| `@nano-agent/nacp-core` 依赖 | Session package 会复用 Core 的部分类型/语义边界 | medium | 只复用稳定字段与思路，不把 Session 写成 Core 的副本 |
| prompt 提交语义未完全冻结 | 当前 Session message set 还没有独立 input family | high | 通过 Q1 冻结最小方案，避免中途返工 |
| 多客户端 attach 歧义 | 会显著放大 replay/ack/heartbeat 复杂度 | high | v1 明确只做单 active attach |
| integration harness 可用性 | reconnect/replay 需要可模拟 websocket/DO storage 的环境 | medium | 先 fake harness；若宿主不足，正式 re-baseline 到 deployment suite |
| adapter drift | hooks / llm-wrapper 若后续各写各的 event shape，会破坏 Session 统一性 | high | Phase 5 先冻结 seam，再让下游对齐 |

### 7.2 约束与前提

- **技术前提**：`@nano-agent/nacp-core` 已可作为稳定 dependency；Session profile 继续使用 TypeScript + zod + JSON Schema 导出路线
- **运行时前提**：宿主为 Cloudflare Workers + Durable Objects + WebSocket；一条连接只服务一个 team；authority 由 server-stamped
- **组织协作前提**：`packages/nacp-session/` 按根 README 约定作为主仓 monorepo 内的 workspace package 管理；设计、计划、审查、源码与测试统一在主仓维护
- **上线 / 合并前提**：至少完成 reconnect/replay 主路径验证，或在 action-plan / code-review 中正式写明 re-baseline 理由

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/nacp-by-opus.md`
  - `docs/design/hooks-by-GPT.md`
  - `docs/design/llm-wrapper-by-GPT.md`
- 需要同步更新的说明文档 / README：
  - 根 `README.md`（如 `packages/nacp-session/` 状态变化）
  - `packages/nacp-session/README.md`
- 需要同步更新的测试说明：
  - `docs/code-review/` 下后续 Session review 文档

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `pnpm build`
  - `pnpm typecheck`
- **单元测试**：
  - 对 `messages / frame / ingress / replay / delivery / heartbeat / websocket / redaction / adapters` 全模块执行 `pnpm test`
- **集成测试**：
  - `session.start → session.stream.event → disconnect → session.resume(replay_from=last_seen_seq+1) → replay` 主路径
  - `ack-required event → session.stream.ack → window 前移` 路径
  - `heartbeat` stale / timeout 路径
- **端到端 / 手动验证**：
  - 用最小 fake client 连接 session DO helper，观察 start / progress / disconnect / resume / end
- **回归测试**：
  - replay out-of-range
  - forged authority
  - stale ack / duplicate ack
  - redaction drift
- **文档校验**：
  - `pnpm build:schema`
  - `pnpm build:docs`
  - 检查 `docs/nacp-session-registry.md` 与 README 中 message table 一致

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `@nano-agent/nacp-session` 已成为一个可独立构建、可独立测试、可独立跟踪的 package
2. Session profile 的 7 个消息 schema、replay/resume/ack/heartbeat 运行时助手均已落到代码层
3. `session.stream.event` 已成为 hooks / tool / llm / compact / system 的统一 client-facing 事件承载层
4. reconnect/replay 主路径已被 integration 验证，或有正式的 `deferred-to-deployment` 记录
5. package README、主仓文档、registry schema artifact 已同步更新

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | Session profile 的 schema、normalize、replay、ack、heartbeat、websocket helper、adapter seam 全部存在且能被下游直接消费 |
| 测试 | 高风险路径均有 unit tests；reconnect/replay 至少一条 integration path 成立 |
| 文档 | action-plan、README、registry doc、相关设计文档对齐 |
| 风险收敛 | authority 边界、replay out-of-range、ack mismatch、redaction drift 都有明确行为与测试 |
| 可交付性 | `packages/nacp-session/` 可作为主仓 workspace package 持续演进，并作为后续 code review 对象 |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`重点关注 Phase 3/4，恢复语义与 websocket helper 可能被低估`
- **哪些编号的拆分还不够合理**：`若 P4-04 的 progress seam 过大，可再拆成主路径与 fallback 路径`
- **哪些问题本应更早问架构师**：`Q1（首条输入）与 Q2（单/多 attach）`
- **哪些测试安排在实际执行中证明不够**：`若 fake websocket harness 无法模拟 hibernation，需要补 deployment suite`
- **模板本身还需要补什么字段**：`若未来 session profile 经常涉及 monorepo workspace / package mirroring 协作，可给模板增加 repo strategy 专栏`

---

## 10. 结语

> 这份 action-plan 以 **冻结 nano-agent 的 WebSocket-first Session profile** 为第一优先级，采用 **先协议后恢复语义、先恢复语义后 transport、再统一 adapter** 的推进方式，优先解决 **client ↔ session DO 的 replay / resume / ack / authority / server-push 统一通道** 这些核心问题，并把 **多客户端 attach、完整 client SDK、ACP bridge、database-first 设计** 作为主要风险边界。整个计划完成后，`@nano-agent/nacp-session` 应达到 **“可恢复、可治理、可被 hooks 与 llm-wrapper 对齐消费的 session 协议基础”**，从而为后续的 **LLM wrapper、fake bash progress、hooks 可观测、真实 session DO 实现** 提供稳定地基。


---

## 11. Opus 4.6 审查意见（对 GPT 制定的 nacp-session 执行计划的评估）

> 审查者: Claude Opus 4.6 (1M context)
> 审查时间: 2026-04-16
> 审查基础: 本文档全部内容 + `packages/nacp-core/` 已完成实现 + `docs/nacp-by-opus.md` v2 设计规范

### 11.1 总体评价

**评级：⭐⭐⭐⭐☆ (4/5) — 方向准确、结构合理、可落地，但有 4 个需要在执行前澄清的接口问题。**

这份 action-plan 做对了三件最重要的事：

1. **Phase 顺序正确**：schema → normalize/stamp → replay/ack → websocket → adapters → docs。这条依赖链与 Core 的"先类型后校验"完全同构，证明 GPT 理解了协议家族的分层哲学。
2. **把 GPT 自己在 nacp-reviewed-by-GPT.md 里指出的 blind spots 全部落到工作项里**：§2.2（replay/resume）→ Phase 3；§2.3（progress 物理路径）→ P4-04；§2.4（authority server-stamped）→ Phase 2；§2.7（hook.broadcast 不是 Core）→ Phase 5 adapters。
3. **把 `session.stream.event` 作为统一 push channel 的决策钉死了**——这是整个 Session profile 的结构性锚点。如果各子系统（hooks / tool / llm / compact）各自发明 push 格式，Session 的 replay buffer 就无法泛化。GPT 用 Phase 5 的 adapter pattern 解决了这个问题。

### 11.2 与 nacp-core 的协同性审查

| 协同维度 | 审查结论 | 说明 |
|----------|---------|------|
| **Session 是否正确依赖 Core？** | ✅ 方向正确，但需显式化 | Plan 说"复用 Core 的部分类型/语义边界"（§7.1）但未列出具体 import 清单 |
| **Session frame 是否 extend Core envelope？** | ⚠️ 未明确 | 设计文档 `nacp-by-opus.md` §7.4 定义了 `NacpSessionFrameSchema = NacpEnvelopeBaseSchema.extend({ session_frame: {...} })`，但 plan 的 `frame.ts` 没有显式提到会 import 并 extend `NacpEnvelopeBaseSchema` |
| **状态机是否复用 Core？** | ⚠️ 有 drift 风险 | Core 的 `state-machine.ts` 已有 `SessionPhase` 和 `isMessageAllowedInPhase()`。Plan §5.2 提到 drift 风险但未规定"Session MUST import Core 的 phase 定义而非重写" |
| **Session 消息是否注册到 Core？** | ✅ 正确不注册 | Session 消息不应进 Core 的 `BODY_SCHEMAS` / `NACP_MESSAGE_TYPES_ALL`——它们是 Session profile 私有的。plan 未提注册 Core，这是正确的 |
| **authority stamping 是否与 Core 一致？** | ✅ 一致 | Core 的 `NacpAuthoritySchema` 有 `stamped_by` / `stamped_at`；Plan Phase 2 的 ingress helper 会消费这些字段 |
| **stream_id / stream_seq 是否复用 Core Trace？** | ✅ 已在 Core 中 | Core 的 `NacpTraceSchema` 已有 `stream_id?: string` 和 `stream_seq?: number`，Session 只需要求它们为 required（在 Session frame schema 里） |
| **error codes 是否与 Core 兼容？** | ✅ 方向正确 | Plan P3-03 的 `NACP_REPLAY_OUT_OF_RANGE` 已在 Core `error-registry.ts` 注册过 |

### 11.3 Core + Session 能否共同承担地基角色

**结论：可以，但前提是 Session 正确消费 Core 的导出面，不重新发明。**

具体判断：

| 地基职责 | Core 已覆盖 | Session 需补齐 | 两者共同形成 |
|---------|-----------|--------------|-------------|
| **内部 worker/DO 通讯** | ✅ 完整 | 不需要 | 内部合同稳定 |
| **客户端 WebSocket 交互** | 不覆盖 | ✅ plan 覆盖 | client ↔ DO 交互稳定 |
| **多租户边界** | ✅ 完整 | Session 只需在 ingress stamping 时消费 Core authority | 租户隔离从 Core 延伸到 client |
| **事件流恢复** | 不覆盖 | ✅ plan Phase 3 覆盖 | 断线重连有协议保障 |
| **所有 server-push 统一通道** | 不覆盖 | ✅ plan Phase 5 覆盖 | hooks / tool / llm 有一个出口 |
| **错误分类与重试** | ✅ 完整 | Session 只需扩展少量 error code | 错误语义一致 |
| **版本兼容** | ✅ 有框架 | Session 复用 Core 的 semver/compat 模式 | 升级策略一致 |

**一句话判断**：如果 nacp-core 是"内部骨架"，nacp-session 就是"外部皮肤"——两者共同构成 nano-agent 与所有消费者（内部 worker + 外部 client）之间的完整通讯契约。

### 11.4 需要在执行前澄清的 4 个接口问题

这些不是 blocker，但如果不在 Phase 1 开始前明确，会导致中途返工。

#### I1. Session 对 Core 的 import 清单必须显式化

**问题**：Plan 只说"复用部分类型"，但 `@nano-agent/nacp-session` 的 `package.json` 应该把 `@nano-agent/nacp-core` 作为 `peerDependency` 还是 `dependency`？具体 import 哪些符号？

**建议**：在 Phase 1 的 P1-01 里增加以下约定：
```json
// package.json
"dependencies": {
  "@nano-agent/nacp-core": "workspace:*"
}
```
最小 import 清单：
- `NacpEnvelopeBaseSchema` / `NacpHeaderSchema` / `NacpAuthoritySchema` / `NacpTraceSchema` / `NacpControlSchema`（Session frame extends Core envelope）
- `NacpProducerRoleSchema` / `NacpProducerIdSchema`（Session 的 role gate 复用 Core 枚举）
- `SessionPhase` / `isMessageAllowedInPhase`（Session 的 state gate 消费 Core 定义）
- `NacpValidationError`（Session 的 validate 路径复用同一异常类）
- `NacpRefSchema`（Session frame 可能携带 refs）

#### I2. `frame.ts` 必须显式 extend `NacpEnvelopeBaseSchema`

**问题**：设计文档 `nacp-by-opus.md` §7.4 定义了：
```ts
const NacpSessionFrameSchema = NacpEnvelopeBaseSchema.extend({
  session_frame: z.object({
    stream_id, stream_seq, last_seen_seq?, replay_from?, delivery_mode, ack_required
  })
});
```
Plan 的 `frame.ts` 应该在 Phase 2 开始时就 import 并 extend 这个 base schema，而不是从零构造一个新 shape。

**建议**：在 P2-01 的工作内容列里加一条："frame.ts 通过 `NacpEnvelopeBaseSchema.extend(...)` 构建 `NacpSessionFrameSchema`，不独立定义信封结构"。

#### I3. 状态机必须 import 而非 redefine

**问题**：Core 已有 `SessionPhase`、`isMessageAllowedInPhase()`、`assertPhaseAllowed()`。Plan §5.2 识别了 drift 风险但未规定解决方案。

**建议**：在 P2-04 的工作内容里明确："Session state gate 调用 `import { isMessageAllowedInPhase } from '@nano-agent/nacp-core'`，不在 Session 包内重新定义 phase 或 allowed-messages 表。如果 Session 需要更细粒度的 sub-phase（如区分 `attached` 与 `awaiting_prompt`），在 Core 的 phase 之上叠加，而非替代。"

#### I4. replay buffer 的 DO storage 持久化策略需要在 Phase 3 前明确

**问题**：Plan P3-01 定义 replay buffer 为 ring buffer，但未说明：
- buffer 存活在哪里（isolate 内存？DO storage？两者混合？）
- DO hibernation 时 buffer 怎么办（内存态清空 → 唤醒后从 DO storage 恢复？）
- 持久化粒度（每条 event 都写 storage？还是 batch checkpoint？）

设计文档 `nacp-by-opus.md` §7.4 说"DO 为每个 stream_id 维护一个环形 buffer（默认 last 200 events），stream buffer 在 DO storage 里；唤醒时从 storage 恢复"。Plan 应该在 P3-01 的描述里显式对齐这一设计。

**建议**：在 P3-01 工作内容列加一条："ring buffer 的热路径在 isolate 内存；DO hibernation 前通过 `state.storage.put('replay:${stream_id}', serialized)` 持久化；唤醒时从 storage 恢复。默认保留 200 条 per stream_id。"

### 11.5 其他审查观察

| 观察 | 评价 |
|------|------|
| **24 个工作项 / 6 Phase / 22-30 天估算** | 合理。Phase 3/4 是真正的复杂度集中区，L 级估算正确。 |
| **Q1-Q4 提问质量** | 高。Q1（session.start 带首条输入？）与 Q2（单/多 attach？）确实必须在 Phase 1 前回答，否则 schema 会反复改。 |
| **Out-of-scope 纪律** | 优秀。O1-O11 的边界清晰，尤其 O3（ACP bridge）和 O6（多客户端 attach）的排除理由合理。 |
| **风险识别** | 准确。"adapter drift"（§7.1）是最大的长期风险——如果 hooks 和 llm-wrapper 各自发明 event shape，Session 的统一 channel 就失效。Phase 5 先冻结 seam 再让下游对齐的策略是正确的。 |
| **Phase 5 的 llm adapter 是 seam 而非实现** | 正确判断。LLM wrapper 尚不存在，此时只能留接口。 |
| **Integration test 策略** | 比 Core 更成熟。Plan 明确要求 reconnect/replay/ack/heartbeat 三条 integration 路径（Phase 6），并允许 re-baseline 到 deployment suite——这比 Core 当时"直接 defer"更审慎。 |

### 11.6 对 Q1-Q4 的 Opus 建议（供业主参考）

| Q# | GPT 建议 | Opus 附议/修正 |
|----|---------|---------------|
| Q1 | session.start 可携带 optional initial_input | **附议**。这避免了"第一条 prompt 走哪条消息"的歧义。如果不带 initial_input，client 需要另发一条"prompt.submit"，但那条消息在 Session profile 里目前不存在。 |
| Q2 | v1 只支持单 active attach | **附议**。多客户端 attach 会让 replay buffer / ack window / authority 的复杂度至少翻 3 倍。 |
| Q3 | delivery_mode 只冻结两档 | **附议**。`at-most-once` + `at-least-once` 足以覆盖"progress 可丢" + "tool result 不可丢"两类场景。 |
| Q4 | last 200 + DO storage checkpoint | **附议，但建议细化**：200 是"per stream_id"的上限；同一 session 可能有多个 stream_id（例如 tool call A 的 progress stream + hook broadcast stream），所以总 buffer 量可能是 200 × N。应在 P3-01 里加一个"总 buffer 上限"（例如 1000 条跨所有 stream）。 |

### 11.7 最终 Verdict

**nacp-session 的 action-plan 可以在 I1–I4 澄清后直接进入执行。**

| 维度 | 评级 | 说明 |
|------|------|------|
| **与设计文档的对齐度** | 4/5 | 覆盖了 nacp-by-opus.md §5.0/§6.2/§7.4 的所有关键点；但 4 个接口细节需显式化 |
| **与 nacp-core 的协同度** | 4/5 | 方向正确但 import 策略需明确；状态机复用需写成规则而非口头共识 |
| **Phase 划分质量** | 5/5 | 依赖链正确、风险分级合理、硬 Phase（3/4）标了正确的工作量 |
| **In-scope / Out-of-scope 纪律** | 5/5 | 边界清晰，没有 scope creep |
| **两个 NACP 包合力能否承担地基** | **是** | Core（内部骨架）+ Session（外部皮肤）= 完整的"对内 + 对外"通讯契约。前提是 Session 消费而非复制 Core 的类型与规则。 |

**一句话**：**这份 plan 是 nacp-core action-plan 的合格续篇。GPT 正确地把 Session profile 从"补一个 websocket.ts"拉高到了"replay/resume + authority + 统一 push channel"的完整子系统。4 个接口澄清项不阻塞 Phase 1 启动，但必须在 P1-01 和 P2-01 的执行过程中落地。建议业主回答 Q1-Q4 后立即推进。**
