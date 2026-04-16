# NACP-Session 代码审查 — by GPT

> 审查对象: `@nano-agent/nacp-session`
> 审查时间: `2026-04-16`
> 审查人: `GPT-5.4`
> 审查范围:
> - `docs/action-plan/nacp-session.md`
> - `packages/nacp-session/`
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**：`该实现已经把 nacp-session 的主要骨架搭出来了，但当前还不应标记为 completed。`
- **结论等级**：`changes-requested`
- **本轮最关键的 1-3 个判断**：
  1. `SessionWebSocketHelper` 使用 **全局 seqCounter**，而 `ReplayBuffer.replay()` 假设的是 **单 stream 连续 seq**；这在多 stream 下会造成**静默丢事件**。
  2. `Session` 的 schema 虽然都写出来了，但 **frame/send path 并没有把“只接受 session 消息 + 按 message_type 校验 body”真正接起来**。
  3. `SessionWebSocketHelper` 当前发出的 frame 使用 **占位 authority** 和 **随机 trace/session_uuid**，而 action-plan 里最关键的 **role requirements / state gate / ack&heartbeat runtime enforcement / integration matrix** 也仍明显不完整。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/nacp-session.md`
  - `docs/templates/code-review.md`
- **核查实现**：
  - `packages/nacp-session/src/*`
  - `packages/nacp-session/test/*`
  - `packages/nacp-session/scripts/*`
  - `docs/nacp-session-registry.md`
- **执行过的验证**：
  - `cd /workspace/repo/nano-agent/packages/nacp-session && git --no-pager status --short && git --no-pager log --oneline -n 5`
  - `cd /workspace/repo/nano-agent/packages/nacp-session && pnpm test && pnpm build && pnpm build:schema && pnpm build:docs`
  - `cd /workspace/repo/nano-agent/packages/nacp-session && node --input-type=module ...`（验证 frame schema / pushEvent 是否真的接入 Session body 校验）

### 1.1 已确认的正面事实

- `packages/nacp-session/` 已经是独立 git repo，当前子仓 clean，HEAD 为 `8c07901 feat: @nano-agent/nacp-session v1.0.0`。
- 包级验证全部通过：`pnpm test`、`pnpm build`、`pnpm build:schema`、`pnpm build:docs` 均成功；当前为 **11 个 test files / 71 tests** 全绿。
- `messages.ts`、`stream-event.ts`、`ingress.ts`、`replay.ts`、`delivery.ts`、`heartbeat.ts`、`websocket.ts`、`adapters/*` 都已经存在，说明 Session profile 的骨架与主要 helper 面已经落地。
- forged authority 路径已有显式拒绝：`normalizeClientFrame()` 在 `packages/nacp-session/src/ingress.ts:30-35` 会抛 `NACP_SESSION_FORGED_AUTHORITY`。
- replay out-of-range 的错误路径已存在：`packages/nacp-session/src/replay.ts:63-68` 明确抛 `NACP_REPLAY_OUT_OF_RANGE`。

### 1.2 已确认的负面事实

- `NacpSessionFrameSchema` 并没有把 Session message registry / body schema 真正接进来：我实际验证后，`NacpSessionFrameSchema.parse(...)` 可以接受 `message_type='tool.call.request'`，也可以接受非法的 `session.stream.event` body 与非法的 `session.start` body。
- `SessionWebSocketHelper` 的 **全局 `seqCounter`** 与 `ReplayBuffer.replay()` 的 **per-stream offset 算法** 不兼容；在多 stream 情况下，会出现 replay 直接返回空数组、从而静默漏发后续 frame 的情况。
- `SessionWebSocketHelper.pushEvent()` 没有调用 `SessionStreamEventBodySchema.parse()`，我实际验证后，`helper.pushEvent('main', { kind: 'not-a-real-kind' })` 会成功并进入 replay buffer。
- `SessionWebSocketHelper.pushEvent()` 生成的 frame 使用 `authority.team_uuid = "_pending"`、`plan_level = "free"`、随机 `trace_id`、随机 `session_uuid`，没有任何来自真实 session / tenant 上下文的输入位点（`packages/nacp-session/src/websocket.ts:82-110`）。
- action-plan 要求的 `per-role requirements` 与 `state gate` 在当前实现中不存在；`src/` 文件列表里也没有 `registry.ts` / `state.ts`，README 还错误声称“Session state machine imports `SessionPhase` / `isMessageAllowedInPhase` from Core”（`packages/nacp-session/README.md:43-46`）。
- action-plan `P6-02` 承诺的三个 integration paths 里，目前只有 `test/integration/reconnect-replay.test.ts` 存在；`ack-window` 与 `heartbeat-timeout` integration tests 缺失。
- 根 README 仍然写着 `packages/nacp-session/` 是“独立 repo（未创建）”（`README.md:99`），与当前事实不一致。

---

## 2. 审查发现

### R1. 全局 `seqCounter` 与 per-stream replay 算法不兼容，会在多 stream 下静默丢事件

- **严重级别**：`critical`
- **类型**：`correctness`
- **事实依据**：
  - `packages/nacp-session/src/websocket.ts:38-45` 只维护一个全局 `seqCounter`，`pushEvent()` 每次都用它生成 `stream_seq`（`websocket.ts:79-109`），不区分 `stream_id`。
  - `packages/nacp-session/src/replay.ts:58-72` 的 `replay()` 假定当前 stream 内的 seq 是连续的：
    - `endSeq = baseSeq + events.length`
    - `offset = fromSeq - baseSeq`
  - 这套算法只有在**单 stream 连续计数**时才成立；一旦 `s1 / s2` 交替发事件，同一 stream 内会出现 seq gap。
  - 独立 review agent 给出的可执行反例已成立：
    1. `push("s1") -> seq 0`
    2. `push("s2")` 多次 -> `seq 1..5`
    3. `push("s1") -> seq 6`
    4. 此时 `s1` buffer 的 `baseSeq=0`、`events.length=2`、`endSeq=2`
    5. `replay("s1", 3)` 会直接命中 `fromSeq >= endSeq`，返回 `[]`
  - 当前测试没有覆盖这个路径：`test/replay.test.ts:10-82` 与 `test/websocket.test.ts:51-62` 都只在单 stream 线性递增场景下验证 replay。
- **为什么重要**：
  - 这是 Session profile 的核心正确性问题：**client 会在 resume 时静默漏掉事件**，而不是显式报错。
  - 这类 bug 比抛异常更危险，因为它会制造“恢复成功但状态不完整”的假象。
- **审查判断**：
  - 当前的 replay/resume 语义在多 stream 场景下是不正确的，因此 `S9 / S13 / S17` 不能视为已收口。
- **建议修法**：
  - 两种修法至少要选一种：
    1. `SessionWebSocketHelper` 改成 **per-stream counter**；
    2. `ReplayBuffer.replay()` 改成按**真实 `stream_seq` 搜索**，不能再用数组 offset 算法假定连续性。
  - 同时补一个真正的多 stream integration test。

### R2. Session frame/runtime validation 没有真正接入 Session registry 与 body schema

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - `packages/nacp-session/src/frame.ts:35-62` 的 `NacpSessionFrameSchema` 只是 `NacpEnvelopeBaseSchema.extend({ session_frame })`；`validateSessionMessageType()` 是独立 helper，但没有被 schema 或 runtime 自动调用。
  - `packages/nacp-session/src/messages.ts:58-85` 定义了 `SESSION_BODY_SCHEMAS` / `SESSION_MESSAGE_TYPES`，但没有看到任何把这些 schema 挂到 `NacpSessionFrameSchema` 或 send path 的代码。
  - `packages/nacp-session/src/websocket.ts:74-121` 的 `pushEvent()` 虽然 `import` 了 `SessionStreamEventBodySchema`（`websocket.ts:12`），但没有实际 parse。
  - 我实际执行验证后，以下两条都被 `NacpSessionFrameSchema.parse(...)` 接受：
    1. `message_type = "tool.call.request"`
    2. `message_type = "session.stream.event"` + `body = { kind: "not-a-real-kind" }`
  - 我还实际执行验证后确认：`SessionWebSocketHelper.pushEvent("main", { kind: "not-a-real-kind" })` 会成功并写入 replay buffer。
- **为什么重要**：
  - 这直接削弱了整个 package 的核心承诺：虽然 schema 被写出来了，但 **运行时并没有被这些 schema 真正保护**。
  - 对 Session profile 来说，这会让非法 `session.*` frame、非法 `stream.event` body，甚至非 Session 消息都可能穿过 helper path，最终破坏 client stream 的稳定性。
- **审查判断**：
  - `S3 / S4 / S5 / S6` 并没有形成完整闭环，目前只能算“schema 已存在，但 runtime wiring 不完整”。
- **建议修法**：
  - 增加一个真正的 `validateSessionFrame(raw)` / `parseSessionFrame(raw)` 入口：
    1. 先校验 `message_type ∈ SESSION_MESSAGE_TYPES`
    2. 再按 `message_type` 分发到 `SessionStartBodySchema / SessionResumeBodySchema / ... / SessionStreamEventBodySchema`
    3. 最后再校验 `session_frame`
  - `normalizeClientFrame()`、`SessionWebSocketHelper.pushEvent()`、`handleResume()`、`restore()` 都应走同一条 parse/validate path，而不是靠 `as NacpSessionFrame`。

### R3. SessionWebSocketHelper 发出的 frame 没有真实 tenant / session / trace 身份

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - `packages/nacp-session/src/websocket.ts:82-110` 在 `pushEvent()` 里硬编码：
    - `authority.team_uuid = "_pending"`
    - `authority.plan_level = "free"`
    - `trace.trace_id = crypto.randomUUID()`
    - `trace.session_uuid = crypto.randomUUID()`
  - `SessionWebSocketHelper` 的 constructor / attach / pushEvent 都没有任何参数能够传入真实 `team_uuid`、`session_uuid`、`trace_id` 或 producer metadata。
- **为什么重要**：
  - 这意味着 helper 发出的 `session.stream.event` frame **并不属于真实会话上下文**，只是语义上看起来像 Session frame。
  - 它会直接破坏：
    - tenant 归属真实性
    - session replay / causal trace 可读性
    - client 侧对 session stream 的身份判断
    - 后续 hooks / llm-wrapper / audit 对 trace continuity 的依赖
- **审查判断**：
  - `S6 / S13 / S14 / S15` 都受到影响：server → client 标准化输出 helper 已存在，但目前输出的是**占位 frame**，不是可信 frame。
- **建议修法**：
  - 让 `SessionWebSocketHelper` 在构造时或 attach 时显式接收 `SessionContext`：
    - `team_uuid`
    - `plan_level`
    - `session_uuid`
    - `trace_id` / trace factory
    - `producer_id`
  - `pushEvent()` 必须复用当前 session 的 authority / trace，而不是每次随机生成。

### R4. action-plan 承诺的 per-role requirements 与 Session state gate 缺失

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **事实依据**：
  - action-plan 明确要求：
    - `S7`：`SESSION_MESSAGE_TYPES` 与 per-role requirements
    - `S8`：Session profile state constraints helper
    - `P2-03 / P2-04`：`client / session / ingress` 的 producer/consumer 与 phase-level legality
  - 当前 `src/` 文件列表中没有 `registry.ts` / `state.ts` 之类的模块；`find src -maxdepth 2 -type f` 只显示 16 个文件，不含这些边界模块。
  - 搜索 `packages/nacp-session/src/` 后，只能找到 `validateSessionMessageType()`，没有任何 `ROLE_REQUIREMENTS` / phase gate / state machine 的实现。
  - 包 README 仍声称：`Session state machine imports SessionPhase / isMessageAllowedInPhase from Core`（`packages/nacp-session/README.md:43-46`），但源码里并不存在这条接线。
- **为什么重要**：
  - Session profile 最大的价值之一就是把 client ↔ session DO 的职责边界和合法转移固定下来。
  - 如果这层没有真正存在，`client / session / ingress` 的行为约束仍然只能散落在调用侧，package 本身并不能兑现它的协议角色。
- **审查判断**：
  - 这是 action-plan `Phase 2` 的实质性缺口，不是风格问题。
- **建议修法**：
  - 增加明确的 `session-registry.ts` / `session-state.ts`：
    - `SESSION_ROLE_REQUIREMENTS`
    - `isSessionMessageAllowedInPhase()`
    - `assertSessionRoleAllowed()`
  - 在 `normalizeClientFrame()` 与 websocket helper 的入口上真正消费这些规则。
  - README 需同步改成与实现一致的表述。

### R5. Ack / heartbeat 现在仍只是 helper，不是被 WebSocket runtime 真正执行的交付语义

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `packages/nacp-session/src/errors.ts:11-18` 定义了：
    - `NACP_SESSION_ACK_MISMATCH`
    - `NACP_SESSION_HEARTBEAT_TIMEOUT`
  - 但在整个包里，搜索结果显示这两个 code **只在 errors.ts 定义，没有任何 runtime 使用**。
  - `packages/nacp-session/src/delivery.ts:44-50` 提供了 `getTimedOut()` / `isBackpressured()`，但 `packages/nacp-session/src/websocket.ts:141-149` 只做了：
    - `handleAck() => this.ackWindow.ack(...)`
    - `handleHeartbeat() => this.heartbeat.recordHeartbeat()`
  - websocket helper 没有：
    - ack mismatch 检测
    - ack timeout 驱动行为
    - backpressure 处理
    - heartbeat timeout 驱动 close / detach / error
- **为什么重要**：
  - 当前的 “at-least-once / ack-required / heartbeat timeout” 更像是**字段和工具类存在**，而不是 Session runtime 的真实交付语义。
  - 这会让调用者误以为自己得到了 delivery guarantee / liveness management，但实际上 helper 并未 enforce。
- **审查判断**：
  - `S10 / S11 / S12 / S13` 目前都只能算部分完成。
- **建议修法**：
  - 在 websocket helper 中真正接入：
    - `ack mismatch` 检测与错误抛出
    - timed-out ack 的处理策略
    - `isBackpressured()` 的发送前检查
    - heartbeat stale/timeout 的关闭或错误上抛路径

### R6. Phase 6 的 integration/test/docs 收口并未真正完成

- **严重级别**：`medium`
- **类型**：`test-gap`
- **事实依据**：
  - action-plan `P6-02` 明确写了三条 integration path：
    - `reconnect-replay.test.ts`
    - `ack-window.test.ts`
    - `heartbeat-timeout.test.ts`
  - 实际 `test/integration/` 下只有：`reconnect-replay.test.ts`。
  - `packages/nacp-session/test/heartbeat.test.ts` 与 `test/delivery.test.ts` 都只是 helper 单测，不是 websocket runtime integration。
  - 根 README 仍写 `packages/nacp-session/` 为“独立 repo（未创建）”（`README.md:99`）。
  - 包 README 仍有不存在的 state machine 说明（`packages/nacp-session/README.md:43-46`）。
- **为什么重要**：
  - Session profile 最难的地方恰恰是 reconnect / ack / heartbeat；如果只有 reconnect-replay 有 integration 级验证，那么最脆弱的两条运行时路径还没有真正收口。
  - 文档漂移会让后续实现者、reviewer、甚至业主对当前状态产生误判。
- **审查判断**：
  - `S17` 与 `S20` 目前只能判定为部分完成。
- **建议修法**：
  - 补齐 `ack-window` 与 `heartbeat-timeout` integration tests；如果当前 harness 不支持，必须像 nacp-core 一样正式 re-baseline 并写入 action-plan / review。
  - 更新根 README 中 `packages/nacp-session/` 的状态。
  - 更新包 README 的 state machine 说明。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | `@nano-agent/nacp-session` package 骨架 | `done` | `package.json` / `tsconfig.json` / `README.md` / `CHANGELOG.md` / `src/index.ts` 都已存在 |
| S2 | WebSocket subprotocol 常量 | `done` | `src/version.ts:1-3` 已冻结 `nacp-session.v1` |
| S3 | 7 个 Session 消息 schema | `done` | `src/messages.ts:10-85` 已实现 |
| S4 | `SessionStreamEventBody` union 与最小 catalog | `done` | `src/stream-event.ts:10-97` 已实现 9 kinds |
| S5 | client → server normalize + server-stamped authority | `partial` | `normalizeClientFrame()` 存在，但不接 schema parse / phase gate，也直接 `as NacpSessionFrame` |
| S6 | server → client 标准化输出 helper | `partial` | `SessionWebSocketHelper.pushEvent()` 存在，但输出占位 authority / trace，且不校验 event body |
| S7 | `SESSION_MESSAGE_TYPES` + per-role requirements | `partial` | `SESSION_MESSAGE_TYPES` 存在，但 `client/session/ingress` 的 role requirements 缺失 |
| S8 | Session 状态约束 helper | `missing` | 未见 `state.ts` / phase gate / illegal transition enforcement |
| S9 | replay buffer helper | `partial` | `src/replay.ts` 存在，但与 `SessionWebSocketHelper` 的全局 seqCounter 组合后会在多 stream 下丢事件 |
| S10 | `delivery_mode` / `ack_required` / ack window helper | `partial` | helper 存在，但 runtime enforcement 不完整 |
| S11 | `NACP_REPLAY_OUT_OF_RANGE` 与 Session error code | `partial` | replay error 已实现；`ACK_MISMATCH` / `HEARTBEAT_TIMEOUT` 未接 runtime |
| S12 | heartbeat / liveness helper | `partial` | `HeartbeatTracker` 存在，但 WebSocket runtime 不消费 timeout/stale 结果 |
| S13 | websocket helper | `partial` | attach/detach/replay/close 已有，但 tenant/trace/ack/heartbeat 都未真正收口 |
| S14 | progress / hook / llm delta → `session.stream.event` adapter seam | `done` | `src/adapters/*` 已存在，LLM adapter 仍保持 seam 形态 |
| S15 | `redaction_hint` 消费器 | `partial` | `redactPayload()` 与 hook adapter 已有，但未成为统一 send path 的内建步骤 |
| S16 | unit tests | `done` | 11 个 test files / 71 tests 中大部分为单测 |
| S17 | integration tests | `partial` | 仅 `reconnect-replay` 存在；`ack-window` / `heartbeat-timeout` 缺失 |
| S18 | schema export | `done` | `scripts/export-schema.ts` 存在，生成 `dist/nacp-session.schema.json` |
| S19 | registry doc generation | `done` | `scripts/gen-registry-doc.ts` 存在，生成 `docs/nacp-session-registry.md` |
| S20 | 独立 repo 跟踪约定与 README 说明 | `partial` | 子仓已存在且 clean，但根 README 仍写“未创建” |

### 3.1 对齐结论

- **done**: `8`
- **partial**: `11`
- **missing**: `1`

> 这更像 **“Session 骨架和若干 helper 已完成，但 runtime guard 与收口工作还没真正闭合”**，而不是 completed。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | 完整 session DO 业务实现 | `遵守` | 当前只实现了 profile/helper，没有 agent loop 本体 |
| O2 | client SDK / browser UI / CLI TUI | `遵守` | 未引入 |
| O3 | ACP bridge | `遵守` | 未实现 |
| O4 | HTTP SSE fallback / provider realtime transport | `遵守` | 未实现 |
| O5 | 多 DO 跨实例 resume / session migration | `遵守` | 当前仅 helper 级 replay buffer |
| O6 | 多客户端并发 attach | `遵守` | `SessionWebSocketHelper.attach()` 会拒绝 double attach |
| O7 | 全量 LLM event taxonomy | `遵守` | 仅有 `llm.delta` seam，没有提前冻结 provider taxonomy |
| O8 | 端到端加密 / WebSocket 压缩协议 | `遵守` | 未实现 |
| O9 | session metrics / analytics / observability pipeline | `遵守` | 未实现 |
| O10 | skill registry / llm registry / database schema | `遵守` | 未实现 |
| O11 | 与真实 Cloudflare deployment 完全绑定的生产级 e2e | `遵守` | 当前是 package 内测试 harness，没有 deployment e2e |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`主体成立，但当前不应标记为 completed`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. **修复 replay/resume 的多 stream 正确性问题**，至少保证：
     - `stream_seq` 与 `ReplayBuffer.replay()` 的计算模型一致
     - 多 stream integration test 能复现并守住该路径
  2. **把 Session registry / body schema / event schema 真正接到 frame/send path**，至少保证：
     - `NacpSessionFrameSchema` 不再接受非 Session message_type
     - `session.start / resume / ... / stream.event` body 在 runtime path 中被真正 parse
     - `SessionWebSocketHelper.pushEvent()` 不再接受非法 event kind
  3. **修复 `SessionWebSocketHelper` 的 authority / trace / session identity 生成方式**，让 server-push frame 使用真实 session metadata，而不是 `_pending` 和随机 UUID
  4. **补齐或正式 re-baseline Phase 2/3/6 的缺口**：
     - `per-role requirements`
     - Session state gate
     - ack/heartbeat runtime enforcement
     - 缺失的 integration tests
- **可以后续跟进的 non-blocking follow-up**：
  1. 更新根 README 对 `packages/nacp-session/` 的状态说明
  2. 修正包 README 中关于 state machine import 的错误表述

> **本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。**
