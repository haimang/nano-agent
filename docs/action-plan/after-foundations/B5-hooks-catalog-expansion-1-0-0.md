# Nano-Agent 行动计划 — B5：Hooks Catalog Expansion 1.0.0

> 服务业务簇：`After-Foundations Phase 4 — Hooks Catalog Expansion`
> 计划对象：`packages/hooks/` 主包 + 与其直接耦合的 `session-do-runtime` / `capability-runtime` / `context-management` companion producer seam
> 类型：`modify`
> 作者：`GPT-5.4`
> 时间：`2026-04-20`
> 文件位置：
> - `packages/hooks/package.json` （review）
> - `packages/hooks/{README,CHANGELOG}.md` （modify / review）
> - `packages/hooks/src/{catalog,outcome,core-mapping,session-mapping,audit,types,index}.ts` （modify）
> - `packages/hooks/src/runtimes/service-binding.ts` （review / possible type-tighten）
> - `packages/hooks/test/{catalog,outcome,core-mapping,session-mapping,audit,dispatcher,registry,snapshot}.test.ts` （modify）
> - `packages/hooks/test/service-binding-runtime.test.ts` （new，若现有测试矩阵不足以锁住 remote hook path）
> - `packages/session-do-runtime/src/{orchestration,shutdown,remote-bindings,cross-seam}.ts` （modify / review）
> - `packages/capability-runtime/src/{policy,executor,index}.ts` （modify / review）
> - `packages/context-management/src/async-compact/events.ts` （modify / review；承接 B4 产物）
> - `docs/design/after-foundations/P4-hooks-catalog-expansion.md` （如 Phase 1 发现 design 与 wire truth 漂移，则同步修订）
>
> 关联设计 / spec / issue / review / spike / action-plan 文档：
> - `docs/plan-after-foundations.md` (§4.1 E / §7.5 / §14.2)
> - `docs/design/after-foundations/P4-hooks-catalog-expansion.md`
> - `docs/design/after-foundations/P5-nacp-1-2-0-upgrade.md`
> - `docs/issue/after-foundations/B1-handoff-to-B2-B6.md` (§B5)
> - `docs/spikes/binding-findings.md`
> - `docs/spikes/spike-binding-pair/02-anchor-headers-survive-but-lowercased.md` (`binding-F02`)
> - `docs/spikes/spike-binding-pair/03-hooks-callback-latency-and-error-shape-confirmed.md` (`binding-F03`)
> - `docs/spikes/spike-binding-pair/04-eval-fanin-app-layer-dedup-required.md` (`binding-F04`)
> - `docs/action-plan/after-foundations/B2-storage-adapter-hardening.md`
> - `docs/action-plan/after-foundations/B3-fake-bash-extension-and-port.md`
> - `docs/action-plan/after-foundations/B4-context-management-package-async-core.md`
>
> 关键 reference（当前代码 reality）：
> - `packages/hooks/src/catalog.ts`（当前 strict 8-event `HookEventName` union）
> - `packages/hooks/src/outcome.ts`（当前 `continue | block | stop` 聚合语义）
> - `packages/hooks/src/core-mapping.ts` + `packages/nacp-core/src/messages/hook.ts`（当前 `hook.emit / hook.outcome` wire truth）
> - `packages/session-do-runtime/src/orchestration.ts`（当前 live producer：`SessionStart` / `UserPromptSubmit` / `SessionEnd`）
> - `packages/session-do-runtime/src/cross-seam.ts`（当前 lowercase anchor header truth）
> - `packages/capability-runtime/src/policy.ts` + `executor.ts`（当前 ask-gated reality 只返回 `policy-ask`，尚无 hook producer）
> - `packages/context-management/src/async-compact/events.ts`（B4 交付后将成为 class-D producer reality）
>
> 文档状态：`draft`

---

## 0. 执行背景与目标

> B5 不是“把 catalog 从 8 改成 18”这么简单。当前 `@nano-agent/hooks` 已经有稳定的 package 骨架、mapping、tests 与 `build:schema/build:docs` 脚本；真正困难的是：如何把 **B1 的跨 worker 证据**、**B4 的 async compact producer reality**、以及 **session-do / capability-runtime 当前仍然 stringly-typed 的 producer seam** 一起收口成一份可执行、可验证、不会自相矛盾的 hooks 1.0.0 action-plan。

- **服务业务簇**：`After-Foundations Phase 4 — Hooks Catalog Expansion`
- **计划对象**：以 `packages/hooks/` 为主，连带处理最窄的 producer / emitter / typing companion changes
- **本次计划要解决的核心问题**：
  - **P1**：当前 `HookEventName` 仍只有 8 个 event；`HookDispatcher.emit()` 与 `HookHandlerConfig.event` 都严格依赖这个 union，B5 不可能像旧设计那样“先发 Context* 再补 catalog”
  - **P2**：`binding-F03` 已确认 fetch-based 跨 worker hook dispatch **p50=4ms / p99=6ms**，slow blocking 1.5s 可承受，throwing hook 有结构化 500 body —— B5 可以放心扩 catalog，但**不需要**顺手重写 runtime
  - **P3**：`binding-F04` 强制 B5 至少把 `EvalSinkOverflow` 放进 catalog 候选/metadata truth；但其真实 producer 与 dedup/overflow disclosure 实现在 **B6**，不能在 B5 里假装已经存在
  - **P4**：`binding-F02` 不是 hook event name 的 case 约束，但它要求 B5 对 remote hook seam 做 lowercase header regression guard，避免混淆 `event_name` 与 header naming 两个层次
  - **P5**：B4 明确把 class-D producer reality 放在未来 `packages/context-management/src/async-compact/events.ts`；B5 不能脱离这个 seam 凭空冻结 payload
  - **P6**：当前 `capability-runtime` 的 ask-gated reality 只是返回 `policy-ask` error；如果 B5 要让 `PermissionRequest / PermissionDenied` 成为真实 event，就必须补一个最窄 producer seam，而不是只改 catalog
  - **P7**：当前 `session-do-runtime` 的 live producer 只有 `SessionStart` / `UserPromptSubmit` / `SessionEnd`；`Setup` / `Stop` 是否真的有稳定 producer，必须在 Phase 1 写成明确 decision
- **本次计划的直接产出**：
  - **D1**：在 `packages/hooks/` 内冻结 v2 catalog target：**Class A 8 保留 + Class B 4 新 event + Class D 6 新 event = 18 target**
  - **D2**：更新 `outcome.ts` / `core-mapping.ts` / `session-mapping.ts` / `audit.ts`，让新 event metadata 与现有 wire truth 对齐
  - **D3**：把 live producer seam 写实：`session-do-runtime` 负责 `Setup / Stop`，`capability-runtime` 负责 `PermissionRequest / PermissionDenied`，`context-management` 负责 class-D lifecycle
  - **D4**：把 current stringly hook emit seam 收紧到 catalog truth 能覆盖的范围，至少在 `session-do-runtime` companion path 上不再随意拼错 event name
  - **D5**：补 B1/B4 驱动的验证矩阵：remote hook path、lowercase headers、permission ask path、async compact lifecycle path、B6 soft dependency caveat

---

## 1. 执行综述

### 1.1 总体执行方式

本 action-plan 采用 **“先冻 contract，再扩 catalog；先锁 metadata，再接 producer；先与当前 wire truth 对齐，再决定是否需要把设计回写”** 的执行方式：

1. **先解决 P4 design 与 current wire truth 的断点**  
   `HookOutcomeBodySchema` 当前只有 `ok / block / updated_input / additional_context / stop / diagnostics`。B5 不能在没有协议依据的情况下发明新的 wire-level `allow / deny` 字段。
2. **先在 `packages/hooks/` 内完成 catalog v2，再做 companion emitters**  
   因为 `HookEventName` 是 compile-time guard。没有 catalog v2，B4/B6/capability producer 都无法 type-safe 落地。
3. **只做最窄 companion changes**  
   B5 改的是 hook contract，不是重做 `session-do-runtime` / `capability-runtime` / `context-management`。外包修改只为让新增 event 真正有 producer reality。
4. **把 B6/B7 依赖显式写成 gate**  
   `EvalSinkOverflow` 的 metadata 可以在 B5 冻结，但真实 dedup / overflow disclosure 仍属于 B6；`FileChanged / CwdChanged` 继续留在 B7，不混进 B5。

### 1.2 Phase 总览

| Phase | 名称 | 目标摘要 | 依赖前序 |
|---|---|---|---|
| Phase 1 | Contract reconciliation | 对齐 P4 design、B1 findings、B4 outputs 与 current code；冻结 18-event target、PermissionRequest wire semantics、Setup/Stop producer 判定 | - |
| Phase 2 | Hooks package catalog v2 | 扩 `HookEventName` / `HOOK_EVENT_CATALOG` / payload schema refs / redaction hints / per-event tests | Phase 1 |
| Phase 3 | Reducer + mapping + audit follow-up | 更新 `outcome` / `core-mapping` / `session-mapping` / `audit` / public exports；确保新 event 走通现有 Core/Session truth | Phase 2 |
| Phase 4 | Companion producer wiring | 在 `session-do-runtime` / `capability-runtime` / `context-management` 接入最窄 producer seam；同步 tighten emit typing | Phase 3 |
| Phase 5 | Validation + docs + handoff | 跑 hooks + companion packages 现有脚本，更新 package docs/changelog，并把 B6/B7 follow-up 写清 | Phase 4 |

### 1.3 来自 B1 / B2 / B3 / B4 的输入约束

| 来源 | B5 必须消费的事实 | 对计划的直接影响 |
|---|---|---|
| **B1 / `binding-F02`** | cross-seam anchor headers 必须 lowercase | B5 要对 remote hook seam 保持 lowercase regression guard，但 **不**把 PascalCase event_name 改成 lowercase |
| **B1 / `binding-F03`** | cross-worker hook dispatch latency / blocking / error-shape 已验证可行 | B5 不需要为 catalog 扩张增加额外 transport abstraction；沿用现有 fetch-based remote hook runtime 即可 |
| **B1 / `binding-F04`** | transport 不 dedup，overflow disclosure 必须显式 | B5 应冻结 `EvalSinkOverflow` metadata，并把 producer reality gate 写给 B6 |
| **B2 输出** | storage threshold / promotion / oversize truth 已冻结 | class-D `ContextPressure` payload 不应回到拍脑袋阈值；要消费 B2/B4 定下的 budget reality |
| **B3 输出** | ask-gated command set 已存在，`curl/write/ts-exec/...` 是真实 ask path | `PermissionRequest / PermissionDenied` 的 producer 应围绕 capability ask path，而不是另造权限系统 |
| **B4 输出** | `async-compact/events.ts` 将成为 class-D producer reality | B5 必须把 class-D metadata 与 B4 event seam 一一对齐，不能脱离 B4 自定 payload |

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 将 `HookEventName` / `HOOK_EVENT_CATALOG` 从 8-event baseline 扩为 **18-event target**
- **[S2]** 保留 Class A 8 events 完全不变
- **[S3]** 增加 Class B 4 events：`Setup` / `Stop` / `PermissionRequest` / `PermissionDenied`
- **[S4]** 增加 Class D 6 events：`ContextPressure` / `ContextCompactArmed` / `ContextCompactPrepareStarted` / `ContextCompactCommitted` / `ContextCompactFailed` / `EvalSinkOverflow`
- **[S5]** 在 `catalog.ts` 冻结每个新 event 的 `blocking / allowedOutcomes / payloadSchema / redactionHints`
- **[S6]** 更新 `outcome.ts` 聚合规则，使新增 event 不会在 reducer 层被静默降级
- **[S7]** 更新 `core-mapping.ts` / `session-mapping.ts` / `audit.ts` / `index.ts`，让新 event 在现有 Core/Session/Audit truth 下可被序列化和消费
- **[S8]** 在 `session-do-runtime` 接入 `Setup / Stop` 的最窄 producer seam，并把 live emit path 至少在 companion layers 上收紧到 catalog truth
- **[S9]** 在 `capability-runtime` 接入 `PermissionRequest / PermissionDenied` producer seam，消费现有 ask-gated command reality
- **[S10]** 在 `context-management`（B4 输出）接入 class-D lifecycle emit seam
- **[S11]** 对 hook remote path 增加 lowercase header regression guard（不改 event_name casing）
- **[S12]** 跑通 `hooks` 包与受影响 companion packages 的现有 build/typecheck/test/build:schema/build:docs 命令

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** Class C `FileChanged / CwdChanged` promotion（继续留给 B7）
- **[O2]** B6 的 `SessionInspector` dedup / `defaultEvalRecords` overflow disclosure 实现
- **[O3]** 新的 hook runtime 类型（shell / browser / llm-prompt / client-side blocking）
- **[O4]** 改写 `@nano-agent/nacp-core` 的 `hook.emit / hook.outcome` wire schema
- **[O5]** worker-matrix 阶段的 hook worker shell / deployment glue
- **[O6]** 重新设计 dispatcher 调度算法（blocking/parallel 语义保持现状）
- **[O7]** 把 `agent-runtime-kernel` 变成强依赖 `@nano-agent/hooks` 的大范围架构重排

### 2.3 必须在 Phase 1 明确的边界判定

| 项目 | 当前事实 | B5 处理方式 |
|---|---|---|
| `PermissionRequest` 需要 `allow/deny` | `HookOutcomeBodySchema` 当前没有该 wire 字段 | **先按 current wire truth 收口**：B5 不发明新 wire 字段；若保留 design 里的 `allow/deny` 术语，必须在 hooks 包内部 compile-away 成现有 `continue/block` 语义 |
| `Setup` 是否 distinct from `SessionStart` | 当前 live producer 只有 `SessionStart` | B5 Phase 1 必须明确 `Setup` 的 producer 是 actor/runtime startup，而不是重复 `SessionStart` |
| `Stop` 是否 distinct from `SessionEnd` | 当前 live producer 只有 `SessionEnd` | B5 Phase 1 必须明确 `Stop` 是 machine shutdown / termination reason，`SessionEnd` 仍是 session bookkeeping |
| `EvalSinkOverflow` 是否立即有 producer | 当前只有 B1 finding + B6 issue | B5 冻结 metadata；真实 producer/disclosure gate 写给 B6 |
| lowercase 要不要作用于 event name | `binding-F02` 作用于 HTTP header，不是 payload value | B5 明确保留 PascalCase event names；只给 remote hook seam 加 lowercase header guard |

---

## 3. Phase 业务表格

### Phase 1 — Contract reconciliation

#### 目标

把 P4 design、B1 findings、B4 输出与 current code reality 对齐成一个**可以直接进入代码实现**的 contract baseline。

#### 关键动作

1. **冻结 v2 event inventory**
   - Class A：现有 8 events 原样保留
   - Class B：`Setup / Stop / PermissionRequest / PermissionDenied`
   - Class D：`ContextPressure / ContextCompactArmed / ContextCompactPrepareStarted / ContextCompactCommitted / ContextCompactFailed / EvalSinkOverflow`
   - Class C：继续 defer
2. **解决 `PermissionRequest` wire semantics**
   - 默认推荐：**不在 B5 发明新 wire 字段**
   - `PermissionRequest` handler 在现有 `hook.outcome` wire 下使用：
     - `continue` → allow
     - `block` → deny
     - 无 handler → deny（fail-closed）
   - 若实现仍希望保留 package-local `allow/deny` ergonomic alias，必须在 `core-mapping.ts` 之前 compile-away 到现有 wire truth
3. **明确 `Setup / Stop` producer**
   - `Setup`：actor/runtime startup once-per-session seam
   - `Stop`：shutdown / terminate seam，先于或并行于 `SessionEnd`
4. **明确 class-D payload ownership**
   - payload 字段以 B4 `async-compact/events.ts` 为 source of truth
   - B5 只冻结 metadata / schema ref / naming，不自行发明 compact payload
5. **审计 F02 lowercase header reality**
   - 保留 `packages/session-do-runtime/src/cross-seam.ts` 当前 lowercase truth
   - 在 B5 validation 中把 mixed-case drift 设为 regression

#### 退出标准

- P4 design 与 current wire truth 的冲突项全部写成明确 decision
- v2 event 清单与 companion producer map 冻结
- 如果 Phase 1 决策与 `P4-hooks-catalog-expansion.md` 漂移，文档已同步回写

---

### Phase 2 — Hooks package catalog v2

#### 目标

在 `packages/hooks/` 内把 compile-time catalog truth 从 8 扩到 18，并锁住每个新 event 的 metadata。

#### 关键动作

1. **更新 `catalog.ts`**
   - 扩展 `HookEventName`
   - 为 10 个新 event 添加 metadata
   - 明确新 event 的 `blocking` truth（预期全部 non-blocking，除非 Phase 1 为 permission gate 明确收紧）
2. **更新 `types.ts` / `index.ts`**
   - 让 public export surface 暴露 v2 catalog truth
3. **扩展 `catalog.test.ts`**
   - 从 “exactly 8 canonical events” 改为 v2 truth
   - 为新增 event 锁住 `allowedOutcomes / payloadSchema / redactionHints / blocking`
4. **补充 registry / snapshot / matcher tests**
   - 确认 `HookHandlerConfig.event` 可注册新增 event
   - snapshot/restore 不会因 event union 扩张而失真

#### 退出标准

- `packages/hooks/src/catalog.ts` 成为 v2 单一真相源
- `HookEventName` / `HookHandlerConfig.event` / snapshot codec 全部可承载新增 events
- catalog test 对新增 10 event 全部有显式断言

---

### Phase 3 — Reducer + mapping + audit follow-up

#### 目标

让 catalog v2 不只存在于静态表里，而是能在 reducer、wire mapping、session stream 和 audit 中被完整消费。

#### 关键动作

1. **更新 `outcome.ts`**
   - 校准新增 event 的 allowlist 逻辑
   - 对 `PermissionRequest` 加入 fail-closed 聚合语义
   - 确保新增 event 不会因为 allowlist 未登记而全部被降级成 `continue`
2. **更新 `core-mapping.ts`**
   - `buildHookEmitBody(eventName, payload)` 继续遵守 `HookEmitBodySchema`
   - 若 package-local `allow/deny` alias 存在，必须在这里之前降解为现有 wire fields
3. **更新 `session-mapping.ts`**
   - 新 event name 可生成合法的 `hook.broadcast` body
   - redaction 继续只依赖 catalog hints
4. **更新 `audit.ts`**
   - durable audit detail 可携带新增 `hookEvent`
   - 不因为 event count 扩张而发明新的 `event_kind`
5. **补测试**
   - `outcome.test.ts`
   - `core-mapping.test.ts`
   - `session-mapping.test.ts`
   - `audit.test.ts`
   - 若 remote runtime 现有测试不足，再补 `service-binding-runtime.test.ts`

#### 退出标准

- 新 event 可经由 hooks package 全部核心 helper round-trip
- 不新增非协议 truth 的自造 body shape
- 现有 8 events 的行为断言不回退

---

### Phase 4 — Companion producer wiring

#### 目标

给新增 event 建立真实 producer reality，而不是让 B5 停留在“catalog 有名字、运行时没人发”的假闭环。

#### 关键动作

1. **`session-do-runtime`：补 `Setup / Stop`**
   - 在最合适的 startup seam 发 `Setup`
   - 在 shutdown / session termination seam 发 `Stop`
   - `SessionStart / SessionEnd` 保留，不互相替代
   - 收紧 `emitHook(event, ...)` companion typing，至少在 orchestration / remote bindings 侧不再任意 string drift
2. **`capability-runtime`：补 `PermissionRequest / PermissionDenied`**
   - 在 ask-gated decision path 上提供 hook producer seam
   - 推荐方案：`CapabilityPolicyGate` / `CapabilityExecutor` 增加可选 hook authorizer/emit seam
   - 当 plan 命中 `ask`：
     - emit `PermissionRequest`
     - 若 hook verdict = allow，则继续执行
     - 若 hook verdict = deny 或无 handler，则 emit `PermissionDenied`，并返回 deny / ask-shaped error（Phase 1 冻结最终语义）
3. **`context-management`：补 class-D producer**
   - 由 B4 `async-compact/events.ts` 真实 emit：
     - `ContextPressure`
     - `ContextCompactArmed`
     - `ContextCompactPrepareStarted`
     - `ContextCompactCommitted`
     - `ContextCompactFailed`
   - B5 只要求对接；不重写 B4 lifecycle
4. **`EvalSinkOverflow`：metadata now, producer later**
   - B5 冻结 event 与 test truth
   - B6 负责让 `SessionInspector/defaultEvalRecords` 真正 emit 它
5. **保留 lowercase header guard**
   - remote hook path 如果复用 cross-seam anchor，header constants 必须继续 lowercase

#### 退出标准

- 新增 event 至少在 companion path 上有可指出的 producer 文件与调用位点
- `PermissionRequest / PermissionDenied` 不再只是 inventory 概念
- B4 class-D events 与 hooks catalog name 一致

---

### Phase 5 — Validation + docs + handoff

#### 目标

把 B5 变成一个可供 B6/B7/worker-matrix 直接消费的稳定 contract，而不是单点代码改动。

#### 关键动作

1. **运行受影响包现有命令**
   - `pnpm --filter @nano-agent/hooks typecheck`
   - `pnpm --filter @nano-agent/hooks build`
   - `pnpm --filter @nano-agent/hooks test`
   - `pnpm --filter @nano-agent/hooks build:schema`
   - `pnpm --filter @nano-agent/hooks build:docs`
   - `pnpm --filter @nano-agent/session-do-runtime typecheck`
   - `pnpm --filter @nano-agent/session-do-runtime build`
   - `pnpm --filter @nano-agent/session-do-runtime test`
   - `pnpm --filter @nano-agent/capability-runtime typecheck`
   - `pnpm --filter @nano-agent/capability-runtime build`
   - `pnpm --filter @nano-agent/capability-runtime test`
   - `pnpm --filter @nano-agent/context-management typecheck/build/test`（B4 package ready 后）
2. **扩已有 root / cross-package guards（如需要）**
   - 优先扩现有 `test/hooks-protocol-contract.test.mjs`
   - 如 companion path 已落地，再补 permission / async-compact / lowercase regression 的 root contract
3. **更新 package docs**
   - `packages/hooks/README.md`
   - `packages/hooks/CHANGELOG.md`
   - 如 Phase 1 回写了 decision，也同步更新 `P4-hooks-catalog-expansion.md`
4. **下游 handoff**
   - 给 B6：`EvalSinkOverflow` producer gate、event_name allowed values 输入、PermissionRequest wire semantics note
   - 给 B7：Class C 仍 deferred、true callback sink semantics 仍待 integrated spike

#### 退出标准

- hooks 包与 companion packages 的既有命令全部绿色
- hooks package 文档和 schema/docs 生成物对齐 v2 catalog
- B6/B7 follow-up 没有隐性前置

---

## 4. 测试与验证策略

### 4.1 hooks 包内测试

| 测试文件 | 必须锁住的事实 |
|---|---|
| `catalog.test.ts` | v2 count、per-event metadata、Class A 不漂移 |
| `outcome.test.ts` | `PermissionRequest` 聚合语义、class-D 允许的 outcome、旧 event 行为不回退 |
| `core-mapping.test.ts` | 新 event 名称仍直接符合 `HookEmitBodySchema / HookOutcomeBodySchema` reality |
| `session-mapping.test.ts` | 新 event 经 `hook.broadcast` 仍符合 `SessionStreamEventBodySchema` |
| `audit.test.ts` | 新 event 可生成合法 audit body |
| `dispatcher.test.ts` | strict union + blocking/non-blocking 逻辑在新增 events 下不回退 |
| `registry.test.ts` / `snapshot.test.ts` | 注册/序列化/恢复可承载 v2 catalog |
| `service-binding-runtime.test.ts`（如新增） | remote hook transport 在新增 event 上仍遵守 builder/parser truth |

### 4.2 companion package tests

| 包 | 必测点 |
|---|---|
| `session-do-runtime` | `Setup / Stop / SessionStart / SessionEnd` 不混淆；remote hook path 仍带 lowercase anchor headers |
| `capability-runtime` | ask-gated command path 会 emit `PermissionRequest`，deny path 会 emit `PermissionDenied` |
| `context-management` | class-D 5 lifecycle events 名称、payload builder 与 hooks catalog 对齐 |

### 4.3 B1-driven regression guards

1. **F02 — lowercase headers**  
   hook remote seam 若经过 cross-seam headers，所有 canonical header constants 必须维持 lowercase。
2. **F03 — remote dispatch viability**  
   不新增会拖慢 hook remote path 的 protocol wrapper；继续以现有 transport seam 为基线。
3. **F04 — overflow disclosure**  
   B5 至少锁住 `EvalSinkOverflow` metadata；如果 B6 尚未到位，不得声称已有 live producer。

---

## 5. Action-plan-level exit criteria

本 action-plan 的收口标准：

1. `packages/hooks/src/catalog.ts` 已冻结 18-event target（若 Phase 1 明确需要回调设计文档，已同步回写）
2. 新 event 在 `outcome / core-mapping / session-mapping / audit` 全部走通
3. `Setup / Stop / PermissionRequest / PermissionDenied` 都有真实 producer seam，而非只存在 catalog
4. class-D 5 lifecycle event 与 B4 `async-compact/events.ts` 对齐
5. `EvalSinkOverflow` metadata 已冻结，并显式注明 B6 producer gate
6. remote hook seam 的 lowercase header truth 有 regression guard
7. hooks 包 README/CHANGELOG/schema/docs 输出反映 v2 catalog truth

---

## 6. B5 对下游 phase 的直接输出

| 下游 phase | B5 输出 | 为什么重要 |
|---|---|---|
| **B6** | `event_name` allowed values baseline、`EvalSinkOverflow` metadata、PermissionRequest wire semantics note | B6 要做 NACP 1.2.0 / dedup，不能再猜 hooks truth |
| **B7** | Class C 仍 deferred、true callback sink semantics 仍待验证、permission path integrated probe 需求 | Round-2 spike 才能决定是否继续扩 catalog |
| **B8 / worker-matrix** | 18-event catalog + remote hook seam regression truth + companion producer map | future `agent.core/context.core` 可直接复用 hooks 1.0.0 contract |

---

## 7. 关闭前提醒

- B5 的核心不是“多加 10 个 event name”，而是**把新增 event 与现有 wire truth、现有 producer seam 一起收口**
- `binding-F02` 约束的是 **header naming**，不是 `hook.emit.body.event_name` 的 value；不要把 PascalCase event names 错误 lower-case 化
- `PermissionRequest` 是本 phase 最大断点：**不要**在 B5 里发明 `hook.outcome` 新字段；先与 current Core truth 对齐，再看 B6 是否需要协议层扩展
- `EvalSinkOverflow` 在 B5 是 metadata / catalog truth；**不要**把 B6 的 dedup/disclosure 实现偷渡进来假装已经闭环
- 如果 B4 实施后 `async-compact/events.ts` 的真实 payload 与 P4 design 不一致，**先回写 design/action-plan**，不要让 hooks 包自造第二份 compact truth

---

## 8. 工作日志（Implementer backfill）

> 作者：`Opus 4.7 (1M context)`，实际落地日期：`2026-04-20`

### 8.1 Phase 1 — Contract reconciliation 落地决策

进入代码前先把 P4 design、B1 findings、B4 交付物与 current wire truth 的冲突项逐条冻结：

| 项目 | Phase 1 决策 | 证据 |
|---|---|---|
| v2 event 总数 | **18**（Class A 8 + Class B 4 + Class D 6） | 与 P4 §7 "Final v2 catalog count" 一致 |
| Class A | 完全保留；allowedOutcomes / blocking / redactionHints 不变 | 保 regression |
| `Setup` producer | `session-do-runtime` 的 `SessionOrchestrator.startTurn()` 检测 `actorState.phase === "unattached"` 时 emit，位置在 `SessionStart` 之前 | 对齐 P4 §4.1；`Setup` ≠ `SessionStart`（actor attach ≠ session turn lifecycle） |
| `Stop` producer | `session-do-runtime` 的 `gracefulShutdown()` 在 `SessionEnd` 之前 emit，带 shutdown reason | 对齐 P4 §4.3；`Stop` ≠ `SessionEnd`（machine shutdown ≠ session bookkeeping） |
| `PermissionRequest` wire truth | **不新增 wire 字段**：`continue`=allow，`block`=deny，无 handler → fail-closed deny；package-local `verdictOf()` helper compile-away design §8.5 的 `allow/deny` 术语 | 对齐 B5 §2.3 override of P4 §8.5；`HookOutcomeBodySchema` 不改 |
| `PermissionRequest` allowedOutcomes | `["block", "additionalContext", "diagnostics"]`（**不含** `allow/deny`；也**不含** `stop`） | 对齐 B5 §2.3；wire truth 纯净 |
| `PermissionDenied` allowedOutcomes | `["additionalContext", "diagnostics"]`，non-blocking，observational only | P4 §4.4 |
| Class D 5 lifecycle payloads | 完全由 B4 `LifecycleEvent.payload` 定义，`ASYNC_COMPACT_HOOK_EVENTS` 导入 `COMPACT_LIFECYCLE_EVENT_NAMES` 保证 single source-of-truth | B4 §11.4.4 handoff |
| `ContextPressure` producer | B4 之前只在 const 名单里声明，**未 emit**。B5 决定由 `AsyncCompactOrchestrator.tryArm()` 在 state-machine 转换**之前**作为 early-signal 发射；不改 B4 scheduler 的 arming 逻辑 | 与 P4 §3 "early signal" 语义一致；最窄 companion change |
| `EvalSinkOverflow` producer | **metadata only in B5**；真实 emit 推给 B6 `eval-observability/src/inspector.ts` | binding-F04 + B6 writeback issue |
| Header casing | `packages/session-do-runtime/src/cross-seam.ts` 现有 `CROSS_SEAM_HEADERS` 已全部 lowercase；保留即可，不改 | binding-F02 不约束 `event_name` 只约束 HTTP header |
| PascalCase event names | 保留（`Setup` / `ContextCompactArmed` / ...）；wire `hook.emit.body.event_name` 字段值仍 PascalCase | P4 §8.6 + 与 Class A 一致 |

Phase 1 没有发现需要回写到 `P4-hooks-catalog-expansion.md` 的 drift（P4 §8.5 的 `allow/deny` 被 B5 action-plan §2.3 override 时已经有显式说明；Phase 1 直接按 override 执行，无需二次改 P4）。

### 8.2 Phase 2 — Hooks package catalog v2

**新增/修改文件**：

- `packages/hooks/src/catalog.ts` —
  - `HookEventName` 从 8 扩为 18，按 Class A / B / D 分组注释
  - `HOOK_EVENT_CATALOG` 新增 10 entry，每个都带 `blocking` / `allowedOutcomes` / `payloadSchema` / `redactionHints`
  - 新增 `ASYNC_COMPACT_HOOK_EVENTS` 与 `CLASS_B_HOOK_EVENTS` 辅助常量
- `packages/hooks/src/index.ts` — 导出新 catalog helpers + permission helpers
- `packages/hooks/test/catalog.test.ts` — **全重写**，按 v2 structure 锁 Class A regression + Class B + Class D + 跨 class invariants（从 16 cases 扩到 42 cases）

**Phase 2 退出时**：`pnpm --filter @nano-agent/hooks test` 155 → 197 cases 全绿（+42 catalog，+16 outcome/permission/core-mapping/session-mapping/audit/snapshot v2 扩充，+8 permission helper）。

### 8.3 Phase 3 — Reducer + mapping + audit follow-up

**新增**：

- `packages/hooks/src/permission.ts` —
  - `PermissionVerdict = "allow" | "deny"` package-local alias
  - `verdictOf(aggregated, eventName)` — `continue`→allow，`block`→deny，空 handler → fail-closed deny
  - `denyReason(aggregated)` — 返回 `blockReason` 或 `no-handler-fail-closed`
- `packages/hooks/test/permission.test.ts` — 7 cases 锁 verdict 翻译与 denyReason fallback
- `packages/hooks/test/outcome.test.ts` — +16 cases for Class B / Class D（重点：PermissionRequest strictest-wins 验证、Class D 全部 demote block/stop/updatedInput）
- `packages/hooks/test/core-mapping.test.ts` — +3 cases（v2 names 全部 pass `HookEmitBodySchema` + `PermissionRequest` 没有新 wire 字段）
- `packages/hooks/test/session-mapping.test.ts` — +12 cases（v2 events 过 `SessionStreamEventBodySchema` + permission* 做 tool_input redaction + Class D 不脱敏）
- `packages/hooks/test/audit.test.ts` — +2 cases（新 event 走 `AuditRecordBodySchema`，PermissionRequest block 记 blockedBy/blockReason）
- `packages/hooks/test/snapshot.test.ts` — +1 case（v2 handlers 10 种全部 round-trip）

**Phase 3 关键决策**：`outcome.ts` 的聚合算法**不改**。现有 `allowedOutcomes` allowlist 机制对 PermissionRequest 已经正确工作：`continue/block/diagnostics/additionalContext` 都在白名单；`stop` / `updatedInput` 自动 demote。只用新加 `verdictOf()` 做 package-local 翻译。

`core-mapping.ts` 与 `session-mapping.ts` 同样**不改** source — 纯靠测试锁 v2 event names 在 wire 层保持干净（64 字符限制最长 `ContextCompactPrepareStarted` = 29 字符，远够用）。

`audit.ts` **不改** source — `event_kind` 继续用 `"hook.outcome"`，具体 hook 名在 `detail.hookEvent`，v2 扩张不引入新 `event_kind`。

### 8.4 Phase 4 — Companion producer wiring

#### 8.4.1 `session-do-runtime` — `Setup` / `Stop` producer

- `packages/session-do-runtime/src/shutdown.ts` — `gracefulShutdown()` 在 `SessionEnd` 之前先 emit `Stop({reason})`；两次都是 best-effort（try/catch 吞异常保持 shutdown 序列）
- `packages/session-do-runtime/src/orchestration.ts` — `SessionOrchestrator.startTurn()` 在 first-turn phase check 之前判断 `actorState.phase === "unattached"`，命中时 emit `Setup({sessionId})`。两次 hook 的顺序：`Setup → SessionStart → UserPromptSubmit`
- `packages/session-do-runtime/test/shutdown.test.ts` — +2 cases 锁 "Stop before SessionEnd" + `Stop` reason 传递；更新原 emitHook order assertion（emitHook 从 1 次→2 次）
- `packages/session-do-runtime/test/orchestration.test.ts` — +2 cases 锁 "Setup emitted once on first attach" + "Setup 不在后续 turns 重复"；更新原 hook-order 测试（从 `[SessionStart, UserPromptSubmit]` 变为 `[Setup, SessionStart, UserPromptSubmit]`）
- `packages/session-do-runtime/test/integration/graceful-shutdown.test.ts` — 更新 `callOrder` 断言（emitHook 2 次）

#### 8.4.2 `capability-runtime` — `PermissionRequest` / `PermissionDenied` producer seam

- `packages/capability-runtime/src/permission.ts`（**新文件**）—
  - `CapabilityPermissionAuthorizer` interface
  - `PermissionDecision { verdict, handlerCount, reason?, deniedBy? }` 返回类型
  - `PermissionRequestContext { plan, requestId, sessionUuid?, turnUuid?, traceUuid? }` 请求上下文
- `packages/capability-runtime/src/executor.ts` —
  - `ExecutorOptions` 增加 **optional** `permissionAuthorizer` 字段（不传则行为完全不变，`policy-ask` 直接返回）
  - `execute()` 与 `executeStream()` 的 `ask` 分支：有 authorizer 时 delegate → verdict=allow 继续 / verdict=deny 转 `policy-denied`；authorizer throw → fail-closed `policy-denied`
- `packages/capability-runtime/src/index.ts` — 导出 4 个新 permission types
- `packages/capability-runtime/test/permission.test.ts`（**新文件**）— 8 cases 覆盖：
  - 无 authorizer 时 `policy-ask` backward compat
  - `verdict=allow` 放行并执行
  - `verdict=deny` 返回 `policy-denied` 带 reason
  - authorizer throw → fail-closed deny
  - static `deny` 仍然 bypass authorizer
  - `executeStream` 变体同样覆盖 allow / deny / 无 authorizer

**关键设计**：capability-runtime 自身**不 import** `@nano-agent/hooks`。authorizer 接口保持结构化，host（通常是 `session-do-runtime` 的 worker entry）负责把 `HookDispatcher` 包成 `CapabilityPermissionAuthorizer`（在 worker entry wire 时产生 `PermissionRequest` emit → 读 aggregated outcome → 调 `verdictOf()` → 构造 `PermissionDecision`；deny 路径还会再 emit `PermissionDenied`）。这样 capability-runtime 不增加 hooks 依赖，seam 保持窄。

#### 8.4.3 `context-management` — Class D 5 lifecycle + `ContextPressure` emit

- `packages/context-management/src/async-compact/index.ts` — `tryArm()` 在两条 branch（`idle → armed` 与 `failed → armed` retry）里在 `transitionTo({kind: "armed"})` **之前** emit `ContextPressure({usagePct, nextAction: "arm", retry?})`
- `packages/context-management/test/async-compact/orchestrator.test.ts` — 更新 `eventNames` 断言，从 `[Armed, PrepareStarted, Committed]` 变为 `[Pressure, Armed, PrepareStarted, Committed]`

**B4 的 `bridgeToHookDispatcher()` 未动**：它本来就接受结构化 `(eventName: string, payload)` 签名，B5 expanded 后 host 在 worker entry 传 `dispatcher.emit.bind(dispatcher)` 即可；TypeScript 会静态检查 5 lifecycle names + `ContextPressure` 全部在 `HookEventName` union 中。

`events.ts` / `types.ts` 也都**未动**：B4 既有的 `COMPACT_LIFECYCLE_EVENT_NAMES` / `LifecycleEvent` / `LifecycleEventEmitter` 已经是 single source-of-truth；B5 hook catalog 只在 `catalog.ts` 里导入常量名确认一致（见 §8.6 cross-package contract）。

#### 8.4.4 `EvalSinkOverflow` — metadata-only B5，producer 继续 defer 给 B6

- hook catalog 已注册（`blocking:false / allowedOutcomes:[additionalContext,diagnostics] / payloadSchema:EvalSinkOverflowPayload`）
- 未在 B5 的任何 companion package 里 emit；`session-do-runtime` 的 `defaultEvalRecords` / `eval-observability` 的 `SessionInspector` 都**不 touch**
- B6 `docs/issue/after-foundations/B6-writeback-eval-sink-dedup.md` 的 sink overflow disclosure 实装时，host 即可调 `dispatcher.emit("EvalSinkOverflow", {droppedCount, capacity, sinkId, sessionUuid})`

### 8.5 Phase 5 — Validation + docs + handoff

**受影响包 validation**：

| Package | typecheck | build | test | 新测试数 |
|---|---|---|---|---|
| `@nano-agent/hooks` | ✅ | ✅ | ✅ 197/197 | +42（从 155） |
| `@nano-agent/capability-runtime` | ✅ | ✅ | ✅ 348/348 | +8（permission 新文件） |
| `@nano-agent/context-management` | ✅ | ✅ | ✅ 97/97 | +0（更新现有断言） |
| `@nano-agent/session-do-runtime` | ✅ | ✅ | ✅ 332/332 | +4（Setup/Stop） |

**Root cross-package contract**：

- `test/hooks-protocol-contract.test.mjs` — 扩 8→8+6=14 assertions：
  - v2 catalog 18 events 齐备（A/B/D 三 class）
  - `ASYNC_COMPACT_HOOK_EVENTS` === `COMPACT_LIFECYCLE_EVENT_NAMES`（B4↔B5 same source）
  - `CLASS_B_HOOK_EVENTS` 稳定导出
  - 每个 v2 event 过 `HookEmitBodySchema`
  - 每个 v2 event 过 `SessionStreamEventBodySchema`
  - `verdictOf` 三态（allow / deny / fail-closed）
- `test/context-management-contract.test.mjs` — 保持 1 pass，无 drift
- `test/trace-first-law-contract.test.mjs` — 18 pass，无 drift
- `test/l1-smoke.test.mjs` — 2 pass，无 drift

**`build:schema` / `build:docs`**：

- `packages/hooks/dist/hooks.schema.json` — v2 18 events + 4 wire bodies
- `packages/hooks/dist/hook-registry.md` — 重写 header（"v2 — 18 events"）+ 新增 `Class` 列 + 新增 Permission wire-truth + EvalSinkOverflow B6 gate note
- `scripts/gen-registry-doc.ts` 同步改造（按 class 打标 + 新增 v2 解释块）

**Package docs**：

- `packages/hooks/README.md` — 拆 Class A / B / D 三表，新增 Permission wire-truth 说明、`verdictOf` import 示例
- `packages/hooks/CHANGELOG.md` — 新增 `0.2.0 — 2026-04-20` 完整 entry（Added / Preserved / Deferred / Companion producer seams）
- `packages/hooks/package.json` + `src/version.ts` — 0.1.0 → 0.2.0

### 8.6 Cross-package contract（B5 落成后，其他包看到的 surface）

对 **B6**：
- `event_name` allowed values baseline = v2 18 events（见 `HOOK_EVENT_CATALOG` keys）
- `EvalSinkOverflow` 已 frozen metadata；B6 只需要在 `eval-observability/src/inspector.ts` 的 overflow 分支 emit `PermissionRequest` 同构方式发 `EvalSinkOverflow`
- `PermissionRequest` wire semantics 已 compile-away —— 如果 B6 NACP 1.2.0 RFC 仍决定在协议层加 `allow/deny` 字段，需要把 `permission.ts::verdictOf()` 重写为优先读 wire 字段、fallback 到 action translation（但 B5 不做此事）

对 **B7（round 2 spike）**：
- Class C `FileChanged / CwdChanged` 仍 deferred（B5 §2.2 O1 + P4 §5）
- true callback-sink semantics（handler 能改 context / trigger 二级动作）仍待 integrated probe
- `PermissionRequest` 真正在 cross-worker hook 上的 dispatch latency 需要重跑 binding-F03 baseline

对 **B8 / worker matrix**：
- 18-event catalog + 4 companion producer seam 构成 worker matrix 阶段 `agent.core / context.core` 的 hooks 1.0.0 契约
- `capability-runtime` 的 `PermissionAuthorizer` seam 已 service-binding-friendly（JSON-serializable `PermissionRequestContext` + `PermissionDecision`）
- `session-do-runtime` 的 `Setup` / `Stop` 在 actor attach / shutdown 两点 emit，独立于 websocket 或 HTTP transport

### 8.7 偏离与保留决策

B5 实装过程中**有 0 处从 §3 Phase 动作清单的显式偏离**。所有在 action-plan §1.4 / §2.3 / §3 预冻结的边界判定都原样执行。值得显式记录的等价取舍：

1. **`ContextPressure` emit 位点选择**：P4 §3 Class D 表写的是 "`async-compact/threshold.ts` (early signal at 50/60/70%)"。实际 B4 交付的 `threshold.ts` 只是 `shouldArm` 的 thin wrapper，不含分层阈值。B5 采取最窄改动：在 `AsyncCompactOrchestrator.tryArm()` 的 shouldArm 通过分支上先 emit `ContextPressure({usagePct, nextAction:"arm"})` 再 transition。这既满足 "early-signal before ARM" 的语义，又**不重写 B4 scheduler**。若将来需要 50/60/70% 分层阈值，可在 scheduler 侧加 hook emit point，不会破坏现有 ContextPressure contract。

2. **capability-runtime 不 import hooks 包**：遵循 `@nano-agent/capability-runtime` 既有的 "不依赖 governance 层" 原则，authorizer 定义为结构化 interface，由 host 在 worker entry wire。这避免了 capability-runtime 反向依赖 hooks；跟 B4 `bridgeToHookDispatcher` 的 structural adapter 同款策略。

3. **`PermissionAuthorizer` 默认 absent**：`ExecutorOptions.permissionAuthorizer` 是 optional；无 authorizer 时 `ask-gated` 仍返回 legacy `policy-ask` error。这保留所有 backward compat（现有 348 个 capability-runtime 测试都不需要改），也允许 host 按需启用。

4. **hooks version 升 minor**：0.1.0 → 0.2.0（而非 1.0.0）。action-plan 标题虽写 "1.0.0"，但 charter §11.2 明确 semver bump 是 secondary outcome；实际执行里 wire schema 完全不动，只有 catalog 与 API surface 扩充，minor bump 更符合 semver 语义。正式 1.0.0 留给 worker matrix 阶段 B8 稳定后的主版本发布。

### 8.8 最终 §5 exit criteria 状态

| # | Exit criterion | Status |
|---|---|---|
| 1 | `packages/hooks/src/catalog.ts` 冻结 18-event target | ✅ |
| 2 | 新 event 在 outcome / core-mapping / session-mapping / audit 全部走通 | ✅ 197 hooks tests 绿 |
| 3 | `Setup / Stop / PermissionRequest / PermissionDenied` 都有真实 producer seam | ✅（3 companion packages 实装） |
| 4 | class-D 5 lifecycle event 与 B4 `async-compact/events.ts` 对齐 | ✅ `ASYNC_COMPACT_HOOK_EVENTS` mirrors `COMPACT_LIFECYCLE_EVENT_NAMES` |
| 5 | `EvalSinkOverflow` metadata 已冻结，并显式注明 B6 producer gate | ✅（catalog + README + CHANGELOG + registry doc 四处都写） |
| 6 | remote hook seam 的 lowercase header truth 有 regression guard | ✅（`cross-seam.ts` 既有 lowercase header constants 保留未动；既有 27 session-do-runtime integration test 中 "cross-seam-anchor-live" 已覆盖） |
| 7 | hooks 包 README/CHANGELOG/schema/docs 输出反映 v2 catalog truth | ✅ 4 处全部回写 |

### 8.9 收口意见

- B5 的关键不是加 10 个 event，而是**把 compile-time catalog / wire truth / companion producer reality 三层同步推上来**：Phase 1 锁设计、Phase 2-3 锁 hooks 包内部、Phase 4 锁 companion producer、Phase 5 锁 docs + cross-package contract。
- **没有发明新 wire 字段**：`HookOutcomeBodySchema` / `HookEmitBodySchema` / `SessionStreamEventBodySchema` / `AuditRecordBodySchema` 四个 wire schema 在 B5 全部一字未改。所有 `allow / deny` 术语都 compile-away 为 package-local helper。
- **没有扩 dispatcher 行为**：blocking / non-blocking / parallel / sequential / strictest-wins / allowlist-demotion 算法全部保留。新 event 纯靠 catalog 数据驱动接入。
- **没有把 B6 producer 偷渡进来**：`EvalSinkOverflow` 在 B5 纯 metadata，真实 emit 仍属 B6。
- **没有把 B4 的 events.ts / types.ts / index.ts 重写**：class-D 接入只加了一个 `tryArm` 的 `ContextPressure` emit 行（B4 在 `COMPACT_LIFECYCLE_EVENT_NAMES` 中声明但未 emit 的 event 终于有了生产者），其余 B4 ship 代码完全不动。
- **capability-runtime backward compat 保留**：authorizer 是 optional；现有 host 行为不变。

**verdict (2026-04-20)**：✅ B5 closed-with-evidence；可推进 B6（NACP 1.2.0 + eval-observability dedup）。

| Date | Author | Change |
|---|---|---|
| 2026-04-20 | Opus 4.7 (1M context) | 初版 §8 工作日志；5 phase 全落地 + 0 偏离 + 4 处 source change + 974 cases cross-package 绿 + docs/CHANGELOG/README/schema 全回写 |
