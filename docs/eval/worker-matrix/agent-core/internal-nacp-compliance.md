# agent.core — internal NACP compliance

> 目标：定义 `agent.core` 作为 host worker 时，必须同时遵守的 **NACP-Core / NACP-Session / tenant / trace / replay / stream** 法则。

---

## 0. 先给结论

**`agent.core` 不是“会说 NACP 的普通 worker”，而是同时站在两层协议边界上的宿主：**

1. **对 client**，它必须以 `@nano-agent/nacp-session` 为唯一 session-profile 真相源；
2. **对下游 remote seam**，它仍必须以 `@nano-agent/nacp-core` 为 internal envelope 真相源；
3. **对自己**，它必须把 authority、tenant、trace、replay、ack、heartbeat、checkpoint 这些 law 执行成 host 责任，而不是“某个 helper 可能会顺手做”的旁路逻辑。

---

## 1. 原始素材召回表

### 1.1 原始文档

| 类型 | 原始路径 | 关键行 / 章节 | 用途 |
|---|---|---|---|
| handoff | `docs/handoff/after-foundations-to-worker-matrix.md` | `§4, §9-§11` | 说明 worker-matrix 进入前哪些 contract law 必须先冻结 |
| review | `docs/code-review/after-foundations/B9-plan-reviewed-by-GPT.md` | `77-110, 173-220` | 说明为什么 session matrix / tenant / `initial_context` 必须拆 ownership |
| review | `docs/code-review/after-foundations/B9-reviewed-by-GPT.md` | `41-80, 84-167` | 记录 B9 早期 review 判断；需与当前代码交叉阅读 |
| evaluation | `docs/eval/after-foundations/smind-contexter-learnings.md` | `214-229, 241-257` | 说明 upstream orchestrator 与 host runtime 的分工，不应被 host 重吞 |

### 1.2 协议源码

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| Core envelope | `packages/nacp-core/src/envelope.ts` | `1-10, 255-372` | 证明 Core 只负责 internal envelope，且有自己的 Layer 6 type×direction matrix |
| Core tenancy | `packages/nacp-core/src/tenancy/boundary.ts` | `20-98` | 证明 tenant boundary 是明确的 protocol gate，而不是审计增强项 |
| Session ingress | `packages/nacp-session/src/ingress.ts` | `25-74` | 证明 authority 由 server stamp，client 不得自带 authority |
| Session frame | `packages/nacp-session/src/frame.ts` | `66-136` | 证明 Session 自己拥有 body/schema/type×direction legality |
| Session matrix | `packages/nacp-session/src/type-direction-matrix.ts` | `14-25` | 证明 Session profile 维护自己的 `(message_type × delivery_kind)` 合法性 |
| Session phase | `packages/nacp-session/src/session-registry.ts` | `1-9, 68-120` | 证明 Session 自己维护 phase matrix，不再委托 Core |
| Session stream | `packages/nacp-session/src/stream-event.ts` | `10-96` | 证明 canonical 9-kind `session.stream.event` 目录 |
| Upstream context | `packages/nacp-session/src/upstream-context.ts` | `1-42` | 证明 `initial_context` 是正式 wire hook |

### 1.3 host 实现源码

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| host ingress | `packages/session-do-runtime/src/do/nano-session-do.ts` | `466-533` | 证明 `acceptClientFrame()` 现在已 `await verifyTenantBoundary()` |
| host dispatch | `packages/session-do-runtime/src/do/nano-session-do.ts` | `608-715` | 证明 `session.start/followup/cancel/resume/ack/heartbeat` 都由 host 真正执行 |
| host storage | `packages/session-do-runtime/src/do/nano-session-do.ts` | `541-601, 1042-1124` | 证明 host 已把 helper/checkpoint/restore 走向 tenant-scoped DO storage |
| HTTP fallback | `packages/session-do-runtime/src/http-controller.ts` | `127-157, 222-237` | 证明 `session.end` 在 client path 上被视为 server-emitted only |

### 1.4 `context/` 参考实现

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| gateway | `context/smind-contexter/src/chat.ts` | `13-18, 132-152, 183-210` | 对照理解“gateway 负责 authority/context 透传，DO 才是宿主” |
| director | `context/smind-contexter/context/director.ts` | `139-189, 215-272` | 对照理解上游 orchestrator 可以先完成 intent/context，再把结果交给下游运行时 |

---

## 2. 协议 ownership：`Session` 与 `Core` 不能再揉成一层

### 2.1 `agent.core` 的双协议职责

| 面向对象 | 应消费的协议层 | 为什么 |
|---|---|---|
| client ↔ host | `@nano-agent/nacp-session` | `normalizeClientFrame()` 在 authority stamping 后直接调用 `validateSessionFrame()`，而 `validateSessionFrame()` 自己检查 Session body/schema/type×direction/stream event：`packages/nacp-session/src/ingress.ts:25-74`; `packages/nacp-session/src/frame.ts:66-136` |
| host ↔ remote seams | `@nano-agent/nacp-core` | `validateEnvelope()` 与 Core matrix 只覆盖 internal message families；文件头已经明确 `NACP-Core` 与 `NACP-Session` 是两个 package：`packages/nacp-core/src/envelope.ts:1-10, 279-372` |

### 2.2 这条拆分为什么是硬要求

如果把 `nacp-core` 错当成 `session.*` 的 validator 替身，会立刻出错：

- Core 的 matrix 只覆盖 `tool / hook / skill / context / system`：`packages/nacp-core/src/type-direction-matrix.ts:17-40`；
- Session 的 matrix 则单独覆盖 `session.start / resume / cancel / end / stream.event / stream.ack / heartbeat / followup_input`：`packages/nacp-session/src/type-direction-matrix.ts:14-25`；
- `session.stream.event` 的 body 还必须符合 canonical 9-kind discriminated union：`packages/nacp-session/src/stream-event.ts:71-96`。

**因此：`agent.core` 可以同时使用两层协议，但不能把两层 validator 合并成一坨。**

---

## 3. `agent.core` 必须执行成宿主责任的合规法则

## 3.1 authority 只能 server-stamped，client 不得伪造

`normalizeClientFrame()` 的第一条硬规则就是：

- client frame 如果自带 `authority`，直接抛 `NACP_SESSION_FORGED_AUTHORITY`：`packages/nacp-session/src/ingress.ts:31-37`；
- 之后才由 ingress context 生成 `authority` 并写入 assembled frame：`packages/nacp-session/src/ingress.ts:47-74`。

这条 law 对 `agent.core` 的含义是：

1. WS 与 HTTP fallback 不能各自发明一套 authority 逻辑；
2. host 不能把 tenant/user/plan 的决定权交还给 client；
3. 上游 gateway 若存在，也只能提供 host 用于 stamping 的输入，而不是替 client 直接写 authority。

`context/smind-contexter` 的 gateway 也是同样分工：`chat.ts` 在 gateway 侧提取 JWT、补 context，再转给 user-level DO：`context/smind-contexter/src/chat.ts:82-112, 132-152, 183-210`。

## 3.2 Session 自己拥有 message legality、phase legality 与 stream-event legality

这条现在已经在源码里明确落成三层：

1. `validateSessionFrame()` 负责 Session message type + body required + body schema：`packages/nacp-session/src/frame.ts:66-136`；
2. `NACP_SESSION_TYPE_DIRECTION_MATRIX` 负责 Session 自己的 type×direction 合法性：`packages/nacp-session/src/type-direction-matrix.ts:14-25`；
3. `session-registry.ts` 负责 Session 自己的 role/phase matrix，文件头明确写着 **Core 的 phase table不覆盖 stream.event/ack/heartbeat**：`packages/nacp-session/src/session-registry.ts:1-9, 68-120`。

对 `agent.core` 的直接要求是：

> client-facing legality 不能再回退到 `nacp-core` 的 envelope validator；host 必须显式消费 `nacp-session` 的 ingress/frame/session-registry truth。

## 3.3 tenant boundary 必须是 ingress gate，而不是“记录了就算做过”

`verifyTenantBoundary()` 在 Core 里写得很重：

- `authority.team_uuid` 必须与 serving/do team 一致；
- `refs[*].team_uuid` 必须与 authority.team_uuid 一致；
- `refs[*].key` 必须以 `tenants/{team_uuid}/` 开头；
- `_platform` 是受限保留值：`packages/nacp-core/src/tenancy/boundary.ts:20-98`。

当前 host 代码也已经把它执行成真正 gate：

```ts
const result = acceptIngress(...);
...
await verifyTenantBoundary(result.frame, {
  serving_team_uuid: doTeamUuid,
  do_team_uuid: doTeamUuid,
  accept_delegation: false,
});
```

见：`packages/session-do-runtime/src/do/nano-session-do.ts:492-517`

而且失败时会返回 `ok: false` 的 typed rejection，阻止 `dispatchAdmissibleFrame()`：`packages/session-do-runtime/src/do/nano-session-do.ts:518-533`。

这意味着 `agent.core` 后续设计里，tenant verify 不能再被降级成“写个 audit record 就结束”。

## 3.4 DO storage 必须 tenant-scoped，不允许回退到裸 key

`NanoSessionDO.getTenantScopedStorage()` 现在已经把 DO storage 包成 tenant-scoped proxy：`packages/session-do-runtime/src/do/nano-session-do.ts:548-601`。

host 侧关键 use-sites 也已经切过去了：

- `session.resume` 写 `LAST_SEEN_SEQ_KEY`：`packages/session-do-runtime/src/do/nano-session-do.ts:662-679`
- `wsHelperStorage()`：`packages/session-do-runtime/src/do/nano-session-do.ts:1042-1053`
- `persistCheckpoint()` / `restoreFromStorage()`：`packages/session-do-runtime/src/do/nano-session-do.ts:1055-1124`

因此对 `agent.core` 的 law 很明确：

> checkpoint / replay helper / `last_seen_seq` / 其他 host 私有持久化状态，都必须先过 tenant wrapper，再落 DO storage。

## 3.5 `session.stream.event` 只能走 canonical 9-kind 目录

`SessionStreamEventBodySchema` 当前锁死 9 个 kind：`packages/nacp-session/src/stream-event.ts:10-96`。

而 `SessionOrchestrator` 也已经按这个目录输出：

- `turn.begin`
- `turn.end`
- `system.notify`
- `llm.delta`

并在文件头明确声明“不会再发明 `turn.started / turn.cancelled / session.ended` 这类旧 kind”：`packages/session-do-runtime/src/orchestration.ts:13-31`。

对应 integration test 也在验证 orchestrator 输出能被 `SessionStreamEventBodySchema` 直接 parse：`packages/session-do-runtime/test/integration/stream-event-schema.test.ts:43-135`。

对 `agent.core` 的含义就是：

> host 层不能再发明“看起来差不多”的 stream kind；任何 lifecycle signal 都必须折回 Session 已冻结的 9-kind 目录。

## 3.6 `session.end` 是 server-emitted family，不是 client command

协议层面，`session.end` 在 Session matrix 里合法方向是 `event`：`packages/nacp-session/src/type-direction-matrix.ts:17-24`。

host HTTP fallback 也把这条落成显式行为：

- 当 host 已接线时，`/end` 返回 `405`
- 错误文案明确写 `session.end is server-emitted`：`packages/session-do-runtime/src/http-controller.ts:222-237`

所以 `agent.core` 后续任何对外 API 设计，都不应把 `session.end` 暴露成 client produce family。

## 3.7 ack / heartbeat / replay 是 host 的持续责任，不是“helper 在某处存在”就算完成

Session package 只定义协议形状：

- `session.stream.ack` body：`packages/nacp-session/src/messages.ts:53-58`
- `session.heartbeat` body：`packages/nacp-session/src/messages.ts:60-63`

真正把它们执行起来的是 host：

- `session.resume`：恢复 helper / 回放 gap / 恢复 checkpoint：`packages/session-do-runtime/src/do/nano-session-do.ts:662-685`
- `session.stream.ack`：推进 ack window：`packages/session-do-runtime/src/do/nano-session-do.ts:688-702`
- `session.heartbeat`：刷新 heartbeat tracker：`packages/session-do-runtime/src/do/nano-session-do.ts:705-709`

因此 `agent.core` 的责任不是“引入这些 schema”，而是**维持它们跨 WS/HTTP/hibernation 仍是一套 host truth**。

## 3.8 `initial_context` 是正式 wire hook，但今天还不是已消费能力

协议层已经很清楚：

- `SessionStartBodySchema.initial_context` 已冻结为 `SessionStartInitialContextSchema`：`packages/nacp-session/src/messages.ts:17-25`
- `SessionStartInitialContextSchema` 允许 `user_memory / intent / warm_slots / realm_hints` 且根 schema `.passthrough()`：`packages/nacp-session/src/upstream-context.ts:18-38`

但 host 侧当前 `dispatchAdmissibleFrame()` 对 `session.start` 做的仍然只是：

```ts
const turnInput = extractTurnInput(messageType, body ?? {});
if (turnInput) { ... startTurn(...) ... }
```

见：`packages/session-do-runtime/src/do/nano-session-do.ts:612-645`

也就是说，当前只能得出下面这个诚实结论：

> `initial_context` 是已冻结的 wire slot，但 `agent.core` 还没有真实 upstream-context consumer。

这点也和 `smind-contexter` 的分层经验一致：gateway / director 可以先完成 intent 与 context 决策，然后再把结构化输入交给下游运行时；下游运行时不一定自己再做一遍：`context/smind-contexter/context/director.ts:165-189, 215-272`。

---

## 4. 历史 review 与当前代码真相的分歧表

| 主题 | 历史 review 口径 | 当前代码真相 | 当前应采用的判断 |
|---|---|---|---|
| tenant verify | 早期 B9 review 认为它仍是 fire-and-forget | `acceptClientFrame()` 已显式 `await verifyTenantBoundary(...)` 并在失败时返回 rejection：`packages/session-do-runtime/src/do/nano-session-do.ts:487-533` | 以**当前代码真相**为准 |
| tenant storage | 早期计划文稿还在讨论 raw `doState.storage.*` 替换 | 当前关键路径已切 `getTenantScopedStorage()`：`packages/session-do-runtime/src/do/nano-session-do.ts:548-601, 1042-1124` | 以**当前代码真相**为准 |
| `initial_context` | B9 把它推进为正式 wire hook | 当前 host 仍未消费 | 两边都成立：**wire 已冻结，consumer 未实现** |

---

## 5. 对后续 `agent.core` 设计的直接要求

1. **继续把 `nacp-session` 当成 client-facing 第一协议层**，不要把 `nacp-core` 拿来兜 Session legality。
2. **tenant verify 与 tenant-scoped storage 任何一条都不允许回退**。
3. **所有 client-visible server push 都只能走 canonical 9-kind `session.stream.event` 目录**。
4. **任何新设计都必须保留“`session.end` 是 server-emitted”这条边界**。
5. **在实现 `initial_context` consumer 之前，不允许把它写成“已完成能力”**。

---

## 6. 本文件的最终判断

从协议合规角度看，`agent.core` 的正确姿态不是“一个统一吃掉所有 message 的超级 worker”，而是：

> **以 `nacp-session` 宿主 client-facing session profile，以 `nacp-core` 处理 internal remote seams，并把 authority / tenant / trace / replay / heartbeat / checkpoint 执行成 host 纪律。**

这也是 worker-matrix 阶段继续推进 `agent.core` 的前提。
