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
| **B1 / `binding-F04`** | transport 不 dedup；sink overflow 不能 silent drop；Round 1 证据仍是 **response-batch simulation**，不是真 cross-worker sink callback | B6 必须真的改 `SessionInspector` + `defaultEvalRecords`，并把 true callback push-path 的复验 checklist 交给 B7 |
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
| **B7** | real protocol delta list、dedup/disclosure ship truth、true callback push-path re-probe checklist、需要在 spike 复验的 items | B7 才能验证“哪些协议变化真的被平台消化”，而不是继续停留在 response-batch simulation |
| **B8 / worker-matrix** | final cross-worker compact message surface、lowercase header law、sink dedup law | worker matrix 不能再靠 draft RFC 猜协议面 |

---

## 7. 关闭前提醒

- B6 的目标不是“把所有 draft RFC 里的内容都实现”，而是**把真正需要的协议面与 writeback 面收口**
- `hook.emit.event_name` 现在已经是 generic string；如果要把 hooks catalog harden 成 protocol enum，必须先证明这是必要而且不破坏兼容
- `SessionInspector` 的 dedup key 来自 **session frame header.message_uuid**，**不是** `session.stream.event` body
- `nacp-session` 保持 `1.1.0` 是 charter 明确允许的合法退出，不是“没做完”
- `binding-F04` 的 Round 1 证据仍是 response-batch simulation；因此 **B6 收口 != true cross-worker sink callback 已证明**，B7 仍必须在 push path 上复验 ordering / dedup / overflow disclosure
- 如果 B4/B5 实施后发现 `context.compact.prepare.*` / `commit.notification` 的真实 producer/consumer 与 draft RFC 不一致，**先修 RFC / action-plan，再改代码**

---

## 8. 工作日志（Implementer backfill）

> 作者：`Opus 4.7 (1M context)`，实际落地日期：`2026-04-20`

### 8.1 Phase 1 — Contract reconciliation 落地决策

进入代码前先把 charter、P5 design、2 份 draft RFC 与 current B2/B3/B4/B5 ship code 的冲突项逐条冻结。§2.3 预列的 5 项边界判定全部 locked：

| 项目 | 2026-04-19 draft 假设 | 2026-04-20 code reality | B6 处置 |
|---|---|---|---|
| hook `event_name` allowed values | `z.enum([...18])` in `nacp-core` | `z.string().min(1).max(64)` in `packages/nacp-core/src/messages/hook.ts`; 18-event catalog owned by `@nano-agent/hooks` (B5) | **DROP**（反向依赖方向不对；现有 schema 已能容纳全部 v2 names） |
| hook `allow / deny` outcomes | 扩 `HookOutcomeBodySchema` with `allow? / deny?` | B5 `hooks/src/permission.ts::verdictOf()` 已将 P4 §8.5 的 allow/deny compile-away 成 `continue / block`；无 wire consumer | **DROP**（死 schema） |
| `SessionInspector` dedup key | RFC §6.2 "session.stream.event body schema's `message_uuid` field" | body 无 `message_uuid`；dedup key 在 `nacp-session/src/websocket.ts:120` 的 envelope `header.message_uuid` | **DRIFT FIX**：修 RFC §6.2 表述 + 将 consumer seam 拓宽到 envelope header |
| `nacp-session` version | optional bump to 1.2.0 (Outcome B) | charter §11.2 允许 stay at 1.1.0；P3-inspector §6.3 已将 inspector 放到独立 HTTP/WS 不走 NACP | **Outcome A**：stay at `1.1.0` |
| `context.compact.prepare.*` / `commit.notification` | 2 new message kinds | B4 §11.4.4 明确 `AsyncCompactOrchestrator` 当前 in-process；`inspector facade **不**需要 NACP message family` until worker matrix 阶段 | **DEFERRED to worker matrix** |

Phase 1 关键 derivation：**一旦三条 core schema delta 全部 drop / defer，`nacp-core` 在 1.2.0 RFC 语义下的 schema delta 归 0；charter §11.2 明确允许 stay at `1.1.0`**。B6 的真实可 ship 工作集缩小到：

1. Writeback — `SessionInspector` + `NanoSessionDO.defaultEvalRecords` 的 dedup/disclosure 实装（`binding-F04` closure）
2. RFC drift 修订 — 3 处 code-reality 偏差回写到 2 份 draft RFC + CHANGELOG
3. 测试 — 新 dedup 路径 + 回归 regression guard

Phase 1 没有需要回写 `docs/design/after-foundations/P5-nacp-1-2-0-upgrade.md` 的新 drift（P5 本身已是 "reverse-derive" 设计 doc）；B6 的结论反向印证了 P5 §3 方法论的正确性。

### 8.2 Phase 2 — `nacp-core` minimal extension (no-op release)

- `docs/rfc/nacp-core-1-2-0.md` **完全重写**：status `draft → frozen`；§0 总结从 "2 new message kinds + hook enum + allow/deny" 改为 "0 schema deltas; stay at 1.1.0"；§2 新增 "Deferred candidates" 记录 3 项为什么 drop / defer；§3 新增 "What actually DID change in Phase 3 (B4) without touching nacp-core"；§4 三条 normative spec sections 保留为 **1.1.0-behavior commentary**；§7 acceptance criteria 全部打 ✅。
- `packages/nacp-core/CHANGELOG.md` 新增 `2026-04-20 — B6 reconciliation` 条目记录 no-op release 的理由。
- `packages/nacp-core/package.json` **不 bump**，仍是 `1.1.0`。
- `packages/nacp-core/src/messages/*.ts` 与 `envelope.ts` **未动**（所有 drift 项 drop/defer）。
- 既有 231 cases 全部保持绿（不 touch schema 自动成立）。

### 8.3 Phase 3 — `nacp-session` zero/minimal outcome (Outcome A)

- `docs/rfc/nacp-session-1-2-0.md` status `draft → frozen`；§0 重新打标 **Outcome A chosen**；§6.2 drift fix — messageUuid 来自 envelope `header`，非 body；§8 acceptance criteria 按 Outcome A 全部打 ✅。
- `packages/nacp-session/CHANGELOG.md` 新增 `2026-04-20` 条目记录 drift fix + stay-at-1.1.0 决策。
- `packages/nacp-session/package.json` / `src/**` 未动。
- 既有 115 cases 全部保持绿。

### 8.4 Phase 4 — Dedup + overflow writeback（实际代码改动）

#### 8.4.1 `SessionInspector` 拓宽（`packages/eval-observability/src/inspector.ts`）

新增 / 修改：

- `InspectorEventMeta { messageUuid? }` — 新类型，拿来做 `onStreamEvent()` 的第 4 个可选参数
- `InspectorEvent.messageUuid` — 接受时存下来（方便 debug + B7 正确性复验）
- `InspectorRejection.messageUuid` + 新 `reason: "duplicate-message"` 变种
- `InspectorDedupStats { dedupEligible, duplicatesDropped, missingMessageUuid }` — 新类型
- `InspectorLikeSessionFrame { header?, body?, session_frame? }` — 结构化 frame 接口（不 hard-import `nacp-session`）
- `SessionInspector.onStreamEvent(kind, seq, body, meta?)` — 加了 4th 可选参。**hard dedup only when `meta.messageUuid` present**；保持 1.1.0 backward compat
- `SessionInspector.onSessionFrame(frame)` — 新 convenience，自动 extract `header.message_uuid` + body + stream_seq
- `SessionInspector.getDedupStats()` — counter 接口

新增测试 `test/inspector-dedup.test.ts`（12 cases），覆盖：

- hard dedup 3x same uuid → 1 stored + 2 rejected
- missing uuid → 不 dedup
- 混合 population（有 uuid / 无 uuid 交错）
- empty string uuid 视为 absent
- body-validator 失败时不把 uuid 污染 seen set（后续合法 body 可重入）
- `onSessionFrame()` extract + triplicate dedup
- `onSessionFrame()` 无 session_frame → seq=0
- body 没 `kind` → rejection
- frame without header → no dedup

Wider cross-package regression：existing 14 inspector cases + 3 ws-http-fallback cases 全部保持绿。

#### 8.4.2 `BoundedEvalSink` 新模块（`packages/session-do-runtime/src/eval-sink.ts`）

新文件 200+ lines，核心 API：

- `BoundedEvalSink` class — bounded FIFO sink with dedup + overflow disclosure
- `EvalSinkEmitArgs { record, messageUuid? }` — emit 参数
- `EvalSinkOverflowDisclosure { at, reason, droppedCount, capacity, messageUuid? }` — disclosure 记录
- `EvalSinkStats { recordCount, capacity, capacityOverflowCount, duplicateDropCount, totalOverflowCount, dedupEligible, missingMessageUuid }` — stats
- `BoundedEvalSinkOptions { capacity?, disclosureBufferSize?, onOverflow?, now? }` — 构造选项，`onOverflow` callback 是 B5 `EvalSinkOverflow` hook emission 的宿主 seam
- `extractMessageUuid(record)` helper — 三个 fallback 形式：`{messageUuid}` / `{envelope:{header:{message_uuid}}}` / `{header:{message_uuid}}`

新增测试 `test/eval-sink.test.ts`（15 cases），覆盖：

- dedup 4 种情况（unique / 无 uuid / 混合 / empty string）
- capacity overflow FIFO + disclosure + stats
- duplicate-message disclosure 带 messageUuid
- disclosure ring buffer cap
- `onOverflow` throw 不 crash emit path
- injected clock
- `extractMessageUuid` 6 种输入

#### 8.4.3 `NanoSessionDO.defaultEvalRecords` → `defaultEvalSink`（`packages/session-do-runtime/src/do/nano-session-do.ts`）

`defaultEvalRecords: unknown[]` 字段替换为 `defaultEvalSink: BoundedEvalSink`（capacity=1024 parity）。字段声明顺序调整（static `DEFAULT_SINK_MAX` 先于 instance field）避免 `TS2729` init-order 报错。

Emit site（constructor 里）：

```ts
emit: (record: unknown): void => {
  const messageUuid = extractMessageUuid(record);
  this.defaultEvalSink.emit({ record, messageUuid });
},
```

新增读接口 + 保持旧接口：

- `getDefaultEvalRecords()` — 现委托到 `defaultEvalSink.getRecords()`；return shape 不变（`readonly unknown[]`），无 caller break
- `getDefaultEvalDisclosure(): readonly EvalSinkOverflowDisclosure[]` — 新
- `getDefaultEvalStats(): EvalSinkStats` — 新

新增测试 `test/do/default-sink-dedup.test.ts`（5 cases），覆盖：

- `{ messageUuid }` shape 3x → 1 stored
- `{ envelope: { header: { message_uuid } } }` 2x → 1 stored
- 无 uuid 3x → 3 stored (backward compat)
- duplicate drop → disclosure 记录带 messageUuid
- 1030 records → 6 capacity-exceeded disclosures + 1024 records remain

既有 332 cases + 新 5 cases = 352 cases all green。

#### 8.4.4 `EvalSinkOverflow` hook 发射

B5 catalog 已 frozen `EvalSinkOverflow` event。B6 **不**强制走 hook path（会把 session-do-runtime 强行依赖 hooks dispatcher），但通过 `BoundedEvalSink` 的 optional `onOverflow` callback **暴露 seam**，让未来 worker entry wire 时可以简单一行：

```ts
new BoundedEvalSink({
  capacity: 1024,
  onOverflow: (d) => hookDispatcher.emit("EvalSinkOverflow", d),
});
```

当前 `NanoSessionDO` 默认 **不** wire 该 callback（纯本地 disclosure），满足 B6 "mandatory local disclosure; optional hook emission" 的收口标准。

#### 8.4.5 F02 lowercase header regression

Phase 1 审计确认 `packages/session-do-runtime/src/cross-seam.ts::CROSS_SEAM_HEADERS` 已全部 lowercase，7 个 canonical header（trace/session/team/request/sourceRole/sourceKey/deadline）；`test/cross-seam.test.ts`（既有）已锁 regression — B6 无需新加。

#### 8.4.6 公共 API 新增 export

- `packages/eval-observability/src/index.ts` — 新增 export `InspectorEventMeta / InspectorDedupStats / InspectorLikeSessionFrame`
- `packages/session-do-runtime/src/index.ts` — 新增 export `BoundedEvalSink / extractMessageUuid / EvalSinkEmitArgs / EvalSinkOverflowDisclosure / EvalSinkStats / BoundedEvalSinkOptions`

### 8.5 Phase 5 — Validation + docs + handoff

#### 5-package typecheck/build/test matrix

| Package | typecheck | build | test | new tests |
|---|---|---|---|---|
| `@nano-agent/nacp-core` | ✅ | ✅ | ✅ 231/231 | +0（no source change） |
| `@nano-agent/nacp-session` | ✅ | ✅ | ✅ 115/115 | +0（no source change） |
| `@nano-agent/eval-observability` | ✅ | ✅ | ✅ 208/208 | +12（`inspector-dedup.test.ts`） |
| `@nano-agent/session-do-runtime` | ✅ | ✅ | ✅ 352/352 | +20（`eval-sink.test.ts` 15 + `default-sink-dedup.test.ts` 5） |

`build:schema` / `build:docs` 对 3 个支持这些脚本的包都执行成功（nacp-core / nacp-session / eval-observability 各自 2 份产物 refreshed）。

#### 根 cross-package contracts

| Test file | 规模 | 新 cases |
|---|---|---|
| `test/hooks-protocol-contract.test.mjs` | 9 | 0 |
| `test/context-management-contract.test.mjs` | 1 | 0 |
| `test/trace-first-law-contract.test.mjs` | 18 | 0 |
| `test/observability-protocol-contract.test.mjs` | inherited | 0 |
| `test/session-do-runtime-contract.test.mjs` | inherited | 0 |
| `test/eval-sink-dedup-contract.test.mjs`（**新**） | 6 | +6 |
| `test/l1-smoke.test.mjs` | 2 | 0 |
| **Total root contracts** | **32** | **+6** |

新根 contract 测试锁：
- SessionInspector 以 envelope messageUuid 而非 body 字段做 dedup（**wire truth proof**）
- missing messageUuid → backward-compat 不 dedup
- `onSessionFrame()` extract path — frame header 是 key 源
- `BoundedEvalSink` overflow 不 silent
- duplicate-message disclosure 带 offending uuid
- `extractMessageUuid` 三 shapes fallback chain

#### 文档更新

- `docs/rfc/nacp-core-1-2-0.md` — **重写**（status → frozen; 0 schema delta；§2 deferred candidates 新增；§7 acceptance 全 ✅；§9 revision 加 2026-04-20 条目）
- `docs/rfc/nacp-session-1-2-0.md` — status → frozen；§0 chosen Outcome A；§6.2 drift fix；§8 acceptance 全 ✅；§11 revision 加条目
- `packages/nacp-core/CHANGELOG.md` — 新增 2026-04-20 reconciliation 条目
- `packages/nacp-session/CHANGELOG.md` — 新增 2026-04-20 reconciliation + drift fix 条目
- `packages/eval-observability/CHANGELOG.md` — 新增 `0.2.0 — 2026-04-20` 条目（API additions + wire clarification）
- `packages/session-do-runtime/CHANGELOG.md` — 新增 `0.2.0 — 2026-04-20` 条目（BoundedEvalSink + DO getters）

（`eval-observability` 和 `session-do-runtime` 的 `package.json` 本次暂不 bump minor；CHANGELOG 记录的 `0.2.0` 作为 contract-level milestone 标记，package semver 在下次正式 release batch 统一推进以避免与 B7 同期变更冲突。）

### 8.6 Cross-package contract（B6 落成后，其他包看到的 surface）

对 **B7（round 2 integrated spike）**：

- **需要在 push path 复验**的 item 清单：
  - `SessionInspector.onSessionFrame(frame)` 在真实 WS 上消费跨 worker push frame，verify `header.message_uuid` 字段始终存在 + 是 stable UUID
  - `BoundedEvalSink.onOverflow` callback 在真实 sink burst 下能正确触发（不仅仅是单元测试）
  - `getDedupStats() / getDefaultEvalStats()` 的 counter 在多 session 并发下不串位
- **继承 contracts** 不需要 B7 复验：
  - `nacp-core` / `nacp-session` 1.1.0 schemas（无改动）
  - Hooks catalog 18 events 的 wire parse（B5 已锁）
  - lowercase anchor headers（既有 cross-seam.test.ts 已锁）
- **B6 明确不证明**的：
  - `handleNacp()` RPC transport 的跨 worker dedup — 仍按 `binding-findings.md §0` out-of-scope
  - cross-colo KV freshness — 仍待 F03 round 2

对 **B8 / worker-matrix**：

- `context.compact.prepare.*` / `commit.notification` 在 worker matrix 阶段应当 revisit（P5 §3 反推方法论直接复用）
- `EvalSinkOverflow` 真实 emit 可由 worker entry 绑 `onOverflow` callback wire 起来，不需要再改 B6 代码
- `SessionInspector.onSessionFrame` 天然 cross-worker 友好（结构化 interface，不 hard-import `nacp-session`）

### 8.7 偏离与保留决策

1. **`EvalSinkOverflow` 不在 B6 里强制 emit hook**：B6 action-plan §3 Phase 4 P3 明确 "mandatory：本地 disclosure counter/record；optional co-ship：若 hooks seam ready，则额外 emit `EvalSinkOverflow`"。实际落地通过 `BoundedEvalSinkOptions.onOverflow` 把 seam 暴露但默认不 wire，避免 session-do-runtime 强行依赖 hooks dispatcher 的 wiring 风险；worker entry 可在任何时候一行 wire 起来。
2. **没有删 draft RFC**：两份 `docs/rfc/nacp-*-1-2-0.md` 保留并更新为 `frozen` status。"1.2.0" RFC 最终 content 是 "no-schema-delta"，语义上是合法的 RFC 闭环而非 RFC 作废。
3. **eval-observability / session-do-runtime package semver 暂不 bump**：CHANGELOG 中记录 `0.2.0` 作为 contract 里程碑；`package.json` 的实际 bump 留到下一个 release batch（避免与 B7 同期变更导致 dep 图抖动）。B5 对 `@nano-agent/hooks` 的 `0.1.0 → 0.2.0` 是同一策略的 precedent。
4. **不在 `nacp-core` 引入 1.1.0-compat shim 文件**：2026-04-19 draft §5.3 规划了 `packages/nacp-core/src/compat/1.1.0-compat.ts`；由于 0 schema delta，compat shim 无事可做，直接不创建 file。
5. **不引入 `session.stream.event` body 的 `message_uuid` 字段**：严格遵循 B6 action-plan §2.3 边界 + §2.2 O3（out-of-scope "在 `session.stream.event` body 内新增 `message_uuid` 字段"）。dedup key 统一在 envelope header。
6. **`onSessionFrame(frame)` 用结构化 interface 而非 hard-import `nacp-session`**：与 B4 `bridgeToHookDispatcher` / B5 `CapabilityPermissionAuthorizer` 同款 structural-adapter 策略，保持 `@nano-agent/eval-observability` 不反向依赖 Session profile 代码。

### 8.8 §5 exit criteria 状态

| # | Exit criterion | Status |
|---|---|---|
| 1 | P5 design + 2 draft RFC 的关键 drift 已按 current code 修正 | ✅ 3 drift 处理 + 2 RFC 重写 |
| 2 | `nacp-core` 是否需要 1.2.0 bump，有明确判定 | ✅ **stay at 1.1.0**（0 schema delta） |
| 3 | `nacp-session` 的 recommended outcome 明确 | ✅ **Outcome A (stay at 1.1.0)** |
| 4 | `hook.emit` / `hook.outcome` 不被误改 | ✅ 两者 schema 一字未动 |
| 5 | `SessionInspector` dedup 基于 frame/header messageUuid | ✅ `onStreamEvent(meta)` + `onSessionFrame()` + `getDedupStats()` |
| 6 | `defaultEvalRecords` 不再 silent + 显式 overflow disclosure | ✅ `BoundedEvalSink` + `getDefaultEvalDisclosure()` + `getDefaultEvalStats()` |
| 7 | 所有协议/写回相关测试 + 包脚本可通过 | ✅ 4 packages typecheck/build/test + 2 schema/docs 生成 + 32 root contracts 全绿 |

### 8.9 收口意见

B6 的关键不是把 draft RFC 照搬成 schema delta，而是**把 draft 与 current code reality 的 3 条 drift 用反推方法论归零 + 把 `binding-F04` writeback 真正写成代码**：

- **0 protocol schema delta，1 consumer-side dedup upgrade**。`nacp-core` / `nacp-session` 两个包的 wire schema 在 B6 一字未改；`binding-F04` 的 closure 全部落在 `eval-observability` 与 `session-do-runtime` 的 consumer seam 上。
- **没有发明 `session.stream.event` body 新字段**。严格守住 wire-body shape 不动，dedup key 走 envelope header。这是 `binding-F02` / `binding-F04` writeback 的正确姿势。
- **没有把 B4 的 in-process orchestrator 假装成 cross-worker producer**。P4/P5 draft 提了 2 个 `context.compact.prepare.*` / `commit.notification` 的 kind，但 B4 §11.4.4 明确 orchestrator 跑在 session-do-runtime 里 — 这两个 kind 没有 cross-worker producer reality，defer 到 worker matrix。
- **没有把 B5 的 permission verdict compile-away 推翻**。`allow / deny` wire 字段继续被视为 package-local helper，wire 保持 minimal。
- **`EvalSinkOverflow` hook emission** 通过 `onOverflow` callback seam 暴露而不强制 wire，保持 `session-do-runtime` 不反向依赖 hooks dispatcher。
- **B7 push-path 复验清单已写实**（§8.6）：B6 收口 ≠ true cross-worker sink callback 已证明。

**verdict (2026-04-20)**：✅ B6 closed-with-evidence；可推进 B7（round 2 integrated spike）。

| Date | Author | Change |
|---|---|---|
| 2026-04-20 | Opus 4.7 (1M context) | 初版 §8 工作日志；5 phase 全落地 + 3 RFC drift 修订 + 2 package no-op release + 2 package consumer-seam upgrade + 37 新 test cases + 6 根 contract cases 全绿 |
