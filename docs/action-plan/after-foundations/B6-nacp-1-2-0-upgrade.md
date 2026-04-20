# Nano-Agent 行动计划 — B6：NACP 1.2.0 Upgrade

> 服务业务簇：`After-Foundations Phase 5 — NACP Protocol Upgrade + Observability Dedup`
> 计划对象：`@nano-agent/nacp-core` / `@nano-agent/nacp-session` / `@nano-agent/eval-observability` / `@nano-agent/session-do-runtime`
> 类型：`modify`
> 作者：`GPT-5.4`
> 时间：`2026-04-20`
> 文件位置：
> - `docs/rfc/nacp-core-1-2-0.md` （modify）
> - `docs/rfc/nacp-session-1-2-0.md` （modify / review）
> - `docs/design/after-foundations/P5-nacp-1-2-0-upgrade.md` （如 Phase 1 发现与代码 reality 漂移，则同步修订）
> - `packages/nacp-core/package.json` （modify / review）
> - `packages/nacp-core/src/messages/{context,hook,index}.ts` （modify / review）
> - `packages/nacp-core/test/{messages/messages,compat,admissibility,transport/transport}.test.ts` （modify）
> - `packages/nacp-session/package.json` （review / conditional modify）
> - `packages/nacp-session/src/{frame,websocket,stream-event,messages,index}.ts` （review / possible narrow modify）
> - `packages/nacp-session/test/{frame,websocket,messages,integration/reconnect-replay}.test.ts` （review / possible modify）
> - `packages/eval-observability/package.json` （review）
> - `packages/eval-observability/src/{inspector,index}.ts` （modify）
> - `packages/eval-observability/test/{inspector,integration/ws-inspector-http-fallback}.test.ts` （modify）
> - `packages/session-do-runtime/package.json` （review）
> - `packages/session-do-runtime/src/{do/nano-session-do,cross-seam}.ts` （modify / review）
> - `packages/session-do-runtime/test/{cross-seam,do/nano-session-do,integration/workspace-evidence-live}.test.ts` （modify）
>
> 关联设计 / spec / review / issue / spike / action-plan 文档：
> - `docs/plan-after-foundations.md` (§4.1 F / §7.6 / §14.2)
> - `docs/plan-after-foundations-reviewed-by-GPT.md` (§2.6)
> - `docs/design/after-foundations/P5-nacp-1-2-0-upgrade.md`
> - `docs/design/after-foundations/PX-async-compact-lifecycle-spec.md`
> - `docs/design/after-foundations/P4-hooks-catalog-expansion.md`
> - `docs/action-plan/after-foundations/B4-context-management-package-async-core.md`
> - `docs/action-plan/after-foundations/B5-hooks-catalog-expansion-1-0-0.md`
> - `docs/issue/after-foundations/B1-handoff-to-B2-B6.md` (§B6)
> - `docs/issue/after-foundations/B6-writeback-eval-sink-dedup.md`
> - `docs/spikes/binding-findings.md`
> - `docs/spikes/spike-binding-pair/02-anchor-headers-survive-but-lowercased.md` (`binding-F02`)
> - `docs/spikes/spike-binding-pair/04-eval-fanin-app-layer-dedup-required.md` (`binding-F04`)
>
> 关键 reference（当前代码 reality）：
> - `packages/nacp-core/src/envelope.ts`（`header.message_uuid` lives on envelope header）
> - `packages/nacp-core/src/messages/hook.ts`（current `hook.emit.event_name` is generic string; no `allow/deny` fields）
> - `packages/nacp-core/src/messages/context.ts`（current only `context.compact.request/response`）
> - `packages/nacp-session/src/stream-event.ts`（`session.stream.event` body has no `message_uuid` field）
> - `packages/nacp-session/src/websocket.ts`（server-pushed session frame carries `header.message_uuid`）
> - `packages/eval-observability/src/inspector.ts`（current API only sees `kind / seq / body`）
> - `packages/session-do-runtime/src/do/nano-session-do.ts`（current `defaultEvalRecords` is raw bounded array with silent FIFO drop）
> - `packages/session-do-runtime/src/cross-seam.ts`（current lowercase header truth already landed）
>
> 文档状态：`draft`

---

## 0. 执行背景与目标

> B6 是 after-foundations 里最容易被“RFC 名字”误导的 phase。表面上它叫 `NACP 1.2.0 upgrade`，但当前真实代码告诉我们：**并不是所有 draft RFC 里的内容都应该真的 ship**。B6 的第一任务不是盲目 bump version，而是把 **协议面**、**session profile 面**、以及 **observability dedup writeback** 三条线按现实代码收口。

- **服务业务簇**：`After-Foundations Phase 5 — NACP Protocol Upgrade + Observability Dedup`
- **计划对象**：`nacp-core` / `nacp-session` / `eval-observability` / `session-do-runtime`
- **本次计划要解决的核心问题**：
  - **P1**：charter 明确要求 B6 **从 Phase 3 真实 producer/consumer reality 反推**，而不是先写死 message family；这意味着 B6 本身必须带有 contract-reconciliation phase
  - **P2**：当前 `packages/nacp-core/src/messages/hook.ts` 的 `event_name` 已经是 `string`，不是 enum；B6 不能把 “18 hook events” 误写成“必须改 core schema 才能支持”
  - **P3**：P5 draft / RFC 仍保留 `allow/deny` hook outcome 字段，但当前 core wire truth 没有这些字段，且 B5 action-plan 已明确 **不要在 B5 发明新 wire 字段**
  - **P4**：`binding-F04` 要求 `SessionInspector` 与 `defaultEvalRecords` 以 `messageUuid` 去重，但当前 `SessionInspector.onStreamEvent()` 只接收 `kind / seq / body`，而 `session.stream.event` body 里根本没有 `message_uuid`
  - **P5**：`nacp-session` 现有 draft RFC 已经倾向“0 new families”，这与 charter 允许 “保持 1.1.0 不 bump” 一致；B6 必须把这条路径当成合法 exit，而不是默认强行 1.2.0
  - **P6**：`binding-F02` 的 lowercase 结论已经体现在 `session-do-runtime/src/cross-seam.ts`，B6 更多是 **spec freeze + regression guard**，不是再发明一套 header truth
  - **P7**：B6 不只管协议文档，还必须把 `binding-F04` 的 writeback 真的写进 `eval-observability` 和 `session-do-runtime`
- **本次计划的直接产出**：
  - **D1**：修正 P5 design / draft RFC 中与 current code 不一致的假设
  - **D2**：决定 `nacp-core` 是否真正需要 1.2.0 schema delta；若需要，则只加**反推后真正成立**的 context compact message kinds
  - **D3**：明确 `nacp-session` 的推荐结果是 **stay at 1.1.0 unless reality proves otherwise**
  - **D4**：让 `SessionInspector` 与 `defaultEvalRecords` 真正具备 dedup + overflow disclosure contract
  - **D5**：把 B6 变成 B7 integrated spike 可直接验证的现实协议面，而不是一组 draft RFC 名字

---

## 1. 执行综述

### 1.1 总体执行方式

本 action-plan 采用 **“先纠 drift，再决定 bump；先把 dedup seam 写实，再谈 spec；先最小化协议增量，再保留 compat”** 的执行方式：

1. **先解决文档与代码 reality 的断点**
   - `hook.emit.event_name` 当前不是 enum
   - `hook.outcome` 当前没有 `allow/deny`
   - `session.stream.event` body 当前没有 `message_uuid`
2. **把 B6 拆成 3 条独立但互相关联的轨**
   - `nacp-core` 协议面
   - `nacp-session` profile 面
   - `observability` / `session-do-runtime` dedup writeback 面
3. **默认最小协议面**
   - 没有真实 producer/consumer reality 的 protocol change，一律 defer 或 dismiss
4. **让 semver 服从 reality**
   - `nacp-core` 只有在真的新增 message kind / schema contract 时才 bump 1.2.0
   - `nacp-session` 允许 stay at `1.1.0`

### 1.2 Phase 总览

| Phase | 名称 | 目标摘要 | 依赖前序 |
|---|---|---|---|
| Phase 1 | Contract reconciliation | 对齐 charter、P5 design、2 份 draft RFC 与 current code；冻结哪些是 drift、哪些是真需求 | - |
| Phase 2 | `nacp-core` minimal extension | 仅为 reverse-derived 的 core message kinds / docs / compat test 落地；默认不碰 hook wire shape | Phase 1 |
| Phase 3 | `nacp-session` zero-or-minimal outcome | 明确 stay at 1.1.0 或 cosmetic 1.2.0 的条件；避免发明 session profile delta | Phase 1 |
| Phase 4 | Dedup + overflow writeback | 落地 `SessionInspector` 与 `defaultEvalRecords` 的 messageUuid dedup / overflow disclosure | Phase 1 |
| Phase 5 | RFC/doc closure + validation | 更新 RFC / README / changelog / tests，并把 B7 follow-up 写清 | Phase 2-4 |

### 1.3 来自 B1 / B4 / B5 的输入约束

| 来源 | B6 必须消费的事实 | 对计划的直接影响 |
|---|---|---|
| **B1 / `binding-F02`** | anchor headers MUST be lowercase | B6 以 spec freeze + regression guard 为主，不重造 header truth |
| **B1 / `binding-F04`** | transport 不 dedup；sink overflow 不能 silent drop | B6 必须真的改 `SessionInspector` + `defaultEvalRecords` |
| **B4 输出** | inspector facade 是 independent HTTP/WS，且 dedup / lowercase / non-NACP route 是 B6 需要收口的现实消费点 | B6 不应把 inspector 再塞回 `nacp-session` 新 family |
| **B5 输出** | `EvalSinkOverflow` metadata 已冻结；PermissionRequest wire semantics note 已明确不要凭空发明新字段 | B6 不能默认把 `allow/deny` 写进 `hook.outcome` |

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 修订 `docs/rfc/nacp-core-1-2-0.md` 与 `docs/rfc/nacp-session-1-2-0.md`，对齐 current code reality
- **[S2]** 反推 `nacp-core` 里是否真的需要新增 `context.compact.prepare.*` / `context.compact.commit.notification`
- **[S3]** 审核 `packages/nacp-core/src/messages/hook.ts` 是否需要改动；默认按 current generic-string truth 保持最小化
- **[S4]** 明确 `nacp-session` 的推荐结果：stay at `1.1.0` 或最小 cosmetic bump
- **[S5]** 在 `SessionInspector` 落地 dedup，但 dedup key 来自 **session frame header.message_uuid**，不是 body field
- **[S6]** 在 `NanoSessionDO.defaultEvalRecords` 落地 dedup + overflow disclosure
- **[S7]** 为 lowercase header、dedup、compat 和新增 context message kinds 补现有测试矩阵
- **[S8]** 如 Phase 1 发现 P5 design 的 drift 需要回写，则同步修订 `docs/design/after-foundations/P5-nacp-1-2-0-upgrade.md`

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** RPC `handleNacp()` transport 的真实性能/ordering 结论（继续留给后续 spike）
- **[O2]** 为 every async compact lifecycle stage 都造 NACP message
- **[O3]** 在 `session.stream.event` body 内新增 `message_uuid` 字段
- **[O4]** Class C hooks / filesystem worker / worker-matrix 协议面
- **[O5]** 重写 `nacp-session` WebSocket profile 的基本 shape
- **[O6]** 任何与 fake-bash / storage adapters / hooks runtime 无直接协议关系的 code drift

### 2.3 必须在 Phase 1 明确的边界判定

| 项目 | 当前事实 | B6 处理方式 |
|---|---|---|
| hook `event_name` allowed values | current schema is `z.string().min(1).max(64)` | **默认不把 18 events 写成 core enum**；hooks package 仍是 event catalog source of truth |
| hook `allow/deny` outcomes | current `HookOutcomeBodySchema` 没有这两个字段 | **默认不新增**；除非 B6 reviewer 明确接受 schema 扩张并同步更新 B5/P5/RFC/tests |
| SessionInspector dedup key | `session.stream.event` body 无 `message_uuid`，但 session frame header 有 `message_uuid` | widen inspector ingest seam to accept frame/header metadata |
| `nacp-session` version | charter 允许 stay at `1.1.0` | B6 推荐把“0 schema delta → keep 1.1.0”写成 primary path |
| `context.compact.prepare.*` / `commit.notification` | P5 draft RFC 已写，但 charter 要求 reverse-derive | 在 Phase 1 以 B4 producer/consumer seam 再确认，避免把 draft 当既成事实 |

---

## 3. Phase 业务表格

### Phase 1 — Contract reconciliation

#### 目标

把 charter、P5 design、2 份 draft RFC 与 current code reality 对齐，冻结 B6 的真正执行边界。

#### 关键动作

1. **修正 3 个最关键 drift**
   - `hook.emit.event_name` 不是 enum
   - `hook.outcome` 没有 `allow/deny`
   - `session.stream.event` body 没有 `message_uuid`
2. **确认 RFC deliverable 结构**
   - 当前 repo 已有 sibling RFC：`nacp-core-1-2-0.md` / `nacp-session-1-2-0.md`
   - B6 以这 2 份 RFC 为正式 deliverable；charter 中 combined RFC 描述视作 umbrella 描述，不再新建第三份重复 RFC
3. **冻结 B6 recommended path**
   - `nacp-core`: only if true protocol delta exists
   - `nacp-session`: stay at `1.1.0` by default
   - `dedup`: must ship regardless of version outcome
4. **回写 P5 design / RFC drafts**
   - 去掉与 current code 冲突的强假设
   - 把 B5 的 permission wire note 纳入 B6 baseline

#### 退出标准

- B6 的 schema-level task、doc-level task、writeback-level task 已完全拆开
- 不再存在“按 draft RFC 误改代码”的风险
- `nacp-core` / `nacp-session` / dedup 三条线的目标明确

---

### Phase 2 — `nacp-core` minimal extension

#### 目标

仅为真正 reverse-derived 的 core protocol delta 落地 schema / registry / compat changes。

#### 关键动作

1. **审核 `context.ts`**
   - 当前已有 `context.compact.request/response`
   - 如果 B4 producer/consumer seam 证明确实需要 prepare/commit 分离：
     - 加 `context.compact.prepare.request`
     - 加 `context.compact.prepare.response`
     - 评估 `context.compact.commit.notification` 是否真需要 NACP，而不是 hook-only
   - 如果 reality 证明现有 `context.compact.request/response` 已够，B6 不新增 kind
2. **默认保持 `hook.ts` 最小化**
   - `event_name` 继续 generic string
   - `HookOutcomeBodySchema` 默认不加 `allow/deny`
   - 若 reviewer 强制决定加新字段，则必须把它变成 **显式 subtask**：同时修改 core schema、hooks parser/builder、B5 docs、capability-runtime tests
3. **更新 core RFC**
   - 把 lowercase header、dedup contract、KV freshness caveat 保留为 normative/informative sections
   - 删除/修正与 current code 不一致的 hook sections
4. **更新 `package.json` / CHANGELOG / docs**
   - 只有在真正有 core schema delta 时才 bump `1.2.0`

#### 退出标准

- `nacp-core` 的任何 schema 变更都能指向真实 producer/consumer seam
- 无为未来 worker-matrix 预埋的 speculative message kind
- compat 路径清晰：1.0.0 / 1.1.0 不 break

---

### Phase 3 — `nacp-session` zero-or-minimal outcome

#### 目标

把 `nacp-session` 从“可能要跟着 1.2.0 bump”收窄为**只有真的有 session profile delta 才动**。

#### 关键动作

1. **以当前 RFC 为 baseline 做 reviewer decision**
   - **Outcome A（推荐）**：stay at `1.1.0`, 0 schema changes
   - **Outcome B（可接受）**：cosmetic `1.2.0`, no schema changes, only cross-RFC/doc alignment
2. **不把 dedup 问题错误塞进 session body schema**
   - `session.stream.event` body 继续保持 current shape
   - dedup 通过 frame header `message_uuid` / consumer-side adapter 解决
3. **仅在需要时补 narrow helper**
   - 如果需要让 live inspector 更容易消费 frame metadata，可在 `nacp-session` 或 consumer adapter 层补 helper，但不改 `SessionStreamEventBodySchema`
4. **更新 session RFC**
   - 修掉 “body has message_uuid” 这类错误表述
   - 把 lower-case / dedup cross-reference 写成 inherited contract，而不是新 session kinds

#### 退出标准

- `nacp-session` 的 version decision 明确
- 不会为了 dedup 强行污染 `session.stream.event` body
- session RFC 与实际 profile schema 完整一致

---

### Phase 4 — Dedup + overflow writeback

#### 目标

让 `binding-F04` 真正落进代码，而不是只停留在协议文档。

#### 关键动作

1. **`SessionInspector`：widen ingest seam**
   - 推荐把 API 扩成以下任一形式：
     - `onStreamEvent(kind, seq, body, meta?: { messageUuid?: string })`
     - 或新增 `onSessionFrame(frame)` helper
   - dedup 默认开启，但**只有拿到 `messageUuid` 时才做 hard dedup**
   - 为测试场景保留 opt-out config
2. **`defaultEvalRecords`：从 raw array 升级为 bounded sink**
   - 记录 seen `messageUuid`
   - 发生 duplicate 时明确不重复入列
   - overflow 时不再 silent FIFO drop
   - 暴露至少以下可观测面：
     - `overflowCount`
     - 最近一次 overflow disclosure record / ring buffer
3. **`EvalSinkOverflow` 的处理**
   - mandatory：本地 disclosure counter/record
   - optional co-ship：若 hooks seam ready，则额外 emit `EvalSinkOverflow`
   - 不把 hook emission 当成关闭 B6 的唯一手段
4. **补写回测试**
   - shared `messageUuid` x3 → 只保留 1 条
   - missing `messageUuid` → 不误 dedup
   - overflow → counter/disclosure 可观察

#### 退出标准

- `SessionInspector` dedup 是真实可用的，不依赖虚构 body field
- `defaultEvalRecords` 的 overflow 不再 silent
- B6 writeback issue 的 acceptance criteria 大部分落地为具体测试

---

### Phase 5 — RFC/doc closure + validation

#### 目标

把 B6 变成 B7 可以直接接入真实 spike worker 的稳定协议面。

#### 关键动作

1. **运行现有包命令**
   - `pnpm --filter @nano-agent/nacp-core typecheck`
   - `pnpm --filter @nano-agent/nacp-core build`
   - `pnpm --filter @nano-agent/nacp-core test`
   - `pnpm --filter @nano-agent/nacp-core build:schema`
   - `pnpm --filter @nano-agent/nacp-core build:docs`
   - `pnpm --filter @nano-agent/nacp-session typecheck`
   - `pnpm --filter @nano-agent/nacp-session build`
   - `pnpm --filter @nano-agent/nacp-session test`
   - `pnpm --filter @nano-agent/nacp-session build:schema`
   - `pnpm --filter @nano-agent/nacp-session build:docs`
   - `pnpm --filter @nano-agent/eval-observability typecheck`
   - `pnpm --filter @nano-agent/eval-observability build`
   - `pnpm --filter @nano-agent/eval-observability test`
   - `pnpm --filter @nano-agent/eval-observability build:schema`
   - `pnpm --filter @nano-agent/eval-observability build:docs`
   - `pnpm --filter @nano-agent/session-do-runtime typecheck`
   - `pnpm --filter @nano-agent/session-do-runtime build`
   - `pnpm --filter @nano-agent/session-do-runtime test`
2. **跑 root contract / cross tests**
   - `pnpm test:contracts`
   - `pnpm test:cross`
3. **更新 RFC / README / CHANGELOG**
   - `nacp-core` README/changelog only if actual version delta
   - `nacp-session` README/changelog only if Outcome B chosen
4. **为 B7 写 handoff**
   - 哪些协议改动已真实落地
   - 哪些是 docs-only inherited contract
   - 哪些仍需 integrated spike 复验（例如 real cross-worker prepare/commit path）

#### 退出标准

- 协议文档、包版本、测试矩阵三者一致
- B7 有明确的 protocol re-probe checklist

---

## 4. 测试与验证策略

### 4.1 `nacp-core`

| 测试文件 | 必须锁住的事实 |
|---|---|
| `test/messages/messages.test.ts` | 新增/保留 message kinds 的 body schema 与 registry truth |
| `test/compat.test.ts` | 1.0.0 / 1.1.0 compat 不 break |
| `test/admissibility.test.ts` | role gate / bodyRequired 与新增 context kinds 对齐 |
| `test/transport/transport.test.ts` | envelope-level behavior 不因新 kinds 漂移 |

### 4.2 `nacp-session`

| 测试文件 | 必须锁住的事实 |
|---|---|
| `test/frame.test.ts` | `session.stream.event` body 仍不含 invented `message_uuid` |
| `test/websocket.test.ts` | pushed frame header 继续带 `message_uuid` |
| `test/messages.test.ts` | 若 Outcome A，schema catalog 完全不变；若 Outcome B，仍无 schema drift |
| `test/integration/reconnect-replay.test.ts` | replay/ack path 不被 version/docs 变更破坏 |

### 4.3 dedup / disclosure

| 包 | 测试文件 | 必须锁住的事实 |
|---|---|---|
| `eval-observability` | `test/inspector.test.ts` | hard dedup only when `messageUuid` available |
| `eval-observability` | `test/integration/ws-inspector-http-fallback.test.ts` | live inspector path can consume frame-level dedup metadata |
| `session-do-runtime` | `test/do/nano-session-do.test.ts` | default sink dedup / overflow count / disclosure |
| `session-do-runtime` | `test/integration/workspace-evidence-live.test.ts` | real emitted evidence records still arrive, but duplicates don’t multiply |
| `session-do-runtime` | `test/cross-seam.test.ts` | lowercase header truth still holds |

---

## 5. Action-plan-level exit criteria

本 action-plan 的收口标准：

1. P5 design 与 2 份 draft RFC 中的关键 drift 已按 current code reality 修正
2. `nacp-core` 是否真的需要 1.2.0 bump，已有明确判定与理由
3. `nacp-session` 的 recommended outcome（stay 1.1.0 or cosmetic 1.2.0）已明确
4. `hook.emit` / `hook.outcome` 不再被误改成与 B5 note 冲突的 shape
5. `SessionInspector` dedup 已改为基于 frame/header messageUuid 的现实方案
6. `defaultEvalRecords` 不再 silent drop 且具备 explicit overflow disclosure
7. 所有协议/写回相关现有测试和包脚本可通过

---

## 6. B6 对下游 phase 的直接输出

| 下游 phase | B6 输出 | 为什么重要 |
|---|---|---|
| **B7** | real protocol delta list、dedup/disclosure ship truth、需要在 spike 复验的 items | B7 才能验证“哪些协议变化真的被平台消化” |
| **B8 / worker-matrix** | final cross-worker compact message surface、lowercase header law、sink dedup law | worker matrix 不能再靠 draft RFC 猜协议面 |

---

## 7. 关闭前提醒

- B6 的目标不是“把所有 draft RFC 里的内容都实现”，而是**把真正需要的协议面与 writeback 面收口**
- `hook.emit.event_name` 现在已经是 generic string；如果要把 hooks catalog harden 成 protocol enum，必须先证明这是必要而且不破坏兼容
- `SessionInspector` 的 dedup key 来自 **session frame header.message_uuid**，**不是** `session.stream.event` body
- `nacp-session` 保持 `1.1.0` 是 charter 明确允许的合法退出，不是“没做完”
- 如果 B4/B5 实施后发现 `context.compact.prepare.*` / `commit.notification` 的真实 producer/consumer 与 draft RFC 不一致，**先修 RFC / action-plan，再改代码**
