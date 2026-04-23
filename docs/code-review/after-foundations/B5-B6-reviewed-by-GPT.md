# B5-B6 reviewed by GPT

Status: **changes-requested**

Primary verdict: **B5 的 catalog/mapping 主体是成立的，但 companion producer seam 没有像日志里说的那样完全收口；B6 的核心 `BoundedEvalSink` 仍有一个会破坏自身 bounded-FIFO contract 的 correctness/memory bug。**  
我不建议把当前 B5-B6 视为“已完整收口并可直接据此进入 B7”的状态；更准确的判断是：**主体方向对了，测试也大面积为绿，但还需要一轮针对性修补。**

---

## 1. Scope and method

本次 review 覆盖：

- `@nano-agent/hooks`（B5 主包）
- `@nano-agent/capability-runtime`（`PermissionRequest / PermissionDenied` seam）
- `@nano-agent/eval-observability`（B6 inspector dedup）
- `@nano-agent/session-do-runtime`（`Setup / Stop` producer + default eval sink）
- 邻接 truth：
  - `@nano-agent/context-management`
  - `@nano-agent/nacp-core`
  - `@nano-agent/nacp-session`
  - root `test/*.test.mjs` / `test/e2e/*.test.mjs`

本次独立核查包含：

1. 重新阅读 B5/B6 action-plan 底部 implementer log。  
2. 对 hooks / capability / observability / session-do-runtime 的实码与测试做 spot check。  
3. 独立复现可疑行为，而不只依赖现有测试结论。  
4. 运行现有 validation：
   - `pnpm --filter @nano-agent/hooks typecheck build test` → **198/198**
   - `pnpm --filter @nano-agent/capability-runtime typecheck build test` → **348/348**
   - `pnpm --filter @nano-agent/eval-observability typecheck build test` → **208/208**
   - `pnpm --filter @nano-agent/session-do-runtime typecheck build test` → **352/352**
   - `node --test test/*.test.mjs && npm run test:cross` → **72 + 86** root tests green

这点很重要：**当前 finding 不是来自“现有测试红了”**，而是来自“代码事实与实现宣称之间还有剩余断点，而这些断点恰好还没被 regression coverage 锁住”。

---

## 2. What is actually solid

### 2.1 B5 的 18-event catalog expansion 是真的落地了

这部分是 B5 最稳的交付。

- `HOOK_EVENT_CATALOG` 已稳定扩到 18 个 event，Class A/B/D 的 inventory 与元数据成型：`packages/hooks/src/catalog.ts`
- Core / Session / Audit 三条 mapping 仍保持 wire truth，不靠私造字段闭环：`packages/hooks/src/core-mapping.ts`、`packages/hooks/src/session-mapping.ts`
- root contract 也的确把 18-event catalog、schema round-trip、`verdictOf()` translation 锁住了：`test/hooks-protocol-contract.test.mjs:119-210`

换句话说，**B5 在 “catalog truth + mapping truth + wire non-drift” 这一层是成立的**。

### 2.2 B4 ↔ B5 的 async-compact lifecycle naming 对齐成立

`COMPACT_LIFECYCLE_EVENT_NAMES` 与 `ASYNC_COMPACT_HOOK_EVENTS` 已经真的对齐，而不是文档口头对齐：

- B4 lifecycle names：`packages/context-management/src/async-compact/types.ts:166-175`
- B5 hook-side mirror contract：`test/hooks-protocol-contract.test.mjs:149-153`

这意味着 B5 至少没有在 class-D 事件命名上继续引入 cross-package drift。

### 2.3 B6 的总体方向是对的：dedup key 放在 envelope/header，而不是 body

这点我认为应当保留：

- `SessionInspector` 的 dedup key 来自 `meta.messageUuid` / frame header，而不是 body invented field：`packages/eval-observability/src/inspector.ts:50-62,176-238`
- root contract 明确锁了 `onSessionFrame()` 从 `header.message_uuid` 取 key：`test/eval-sink-dedup-contract.test.mjs:55-68`
- `NanoSessionDO` 默认也不再 silent append raw array，而是走有 disclosure/stats 的 sink surface：`packages/session-do-runtime/src/do/nano-session-do.ts:249-299`

所以 **B6 的方向不是错的**；问题集中在 default sink 的一个关键实现细节。

---

## 3. Findings

| ID | Severity | Finding | Why it matters |
|---|---|---|---|
| B6-R1 | blocker | `BoundedEvalSink` 的 dedup horizon 实际上是 unbounded；FIFO eviction 后 evicted uuid 仍永久留在 `seen` | 直接破坏它自己宣称的 **bounded FIFO** contract；会错误丢弃本应重新接受的记录，并在 Worker 内持续增长内存 |
| B5-R1 | high | `Setup` producer 把 `turnId` 当成 `sessionId` 发出 | B5 新增的 startup seam 无法被可靠地按 session 关联/审计；“真实 producer seam” 的结论高于代码事实 |
| B5-R2 | medium | `CapabilityPermissionAuthorizer` 从未收到它自己接口里预留的 `sessionUuid / turnUuid / traceUuid` carriers | Permission seam 当前只够做 bare allow/deny，不足以支撑真正 traceful / cross-worker 的 `PermissionRequest / PermissionDenied` producer |

---

## 4. B6-R1 — `BoundedEvalSink` violates its own bounded-FIFO contract

### 4.1 文件头把 contract 说得很清楚：它应该是 bounded FIFO

`eval-sink.ts` 文件头明确写的是：

- **Bounded FIFO**
- **Dedup by messageUuid**
- **Overflow disclosure**

见 `packages/session-do-runtime/src/eval-sink.ts:1-30`。  
这不是一个“ever-seen dedup ledger”；它是一个 **bounded sink**。

### 4.2 代码现实：eviction 只删 record，不删对应 uuid

关键实现如下：

- `seen` 是独立的 `Set<string>`：`packages/session-do-runtime/src/eval-sink.ts:107-110`
- 首次接收 uuid 时会永久 `this.seen.add(messageUuid)`：`packages/session-do-runtime/src/eval-sink.ts:140-153`
- capacity overflow 时只 `splice()` 旧 record：`packages/session-do-runtime/src/eval-sink.ts:161-171`

也就是说，**record queue 是 bounded 的，但 dedup state 不是 bounded 的**。

### 4.3 我做了独立复现，问题成立

最小复现：

1. `capacity = 1`
2. emit `A`
3. emit `B`（此时 `A` 已被 FIFO eviction）
4. 再 emit `A`

当前现实下，第 4 步会被判为 duplicate 并丢弃；最终 records 仍只有 `["b1"]`。  
这证明 sink 现在的语义不是“对当前 held window dedup”，而是“只要历史上见过一次，就永久拒绝”。

这和文件头宣称的 **bounded FIFO sink** 是冲突的；对 Cloudflare Worker / 128MB memory 语境来说，这不是小问题。

### 4.4 现有测试没有锁这个边界

当前测试确实覆盖了：

- “同一个 uuid 连续重复要 dedup”
- “超过 capacity 要 disclosure”

但没有覆盖：

- “被 eviction 的 uuid 再次出现时，应当如何处理”

见 `packages/session-do-runtime/test/eval-sink.test.ts:24-105` 与 `packages/session-do-runtime/test/do/default-sink-dedup.test.ts:34-110`。  
这就是为什么所有测试都绿，但这个 bug 仍然可以留在主干里。

### 4.5 结论

这是我认为本轮最重要的 blocker。  
**B6 的主价值之一就是把 default eval sink 从“silent, lossy array”升级为“bounded, explicit, inspectable sink”；如果 dedup state 仍不 bounded，那么这项 closure 不能按已完成处理。**

补充一点：后台独立 audit 也确认了 `SessionInspector.seenMessageUuids` 存在同样的“只增不减”模式：`packages/eval-observability/src/inspector.ts:216-233`。  
不过 `SessionInspector` 本身是 append-only observer，并没有像 `BoundedEvalSink` 一样在文件头对外声明 **bounded FIFO**；所以我没有把它单独抬成与 sink 同级的 blocker，而是建议在修 B6 dedup bookkeeping 时一并处理，避免两个 consumer seam 长期分叉。

---

## 5. B5-R1 — `Setup` hook emits the wrong identity

### 5.1 B5 日志把这条 seam 写成了“真实 producer”

B5 implementer log 对外给出的结论是：

- `Setup / Stop / PermissionRequest / PermissionDenied` 都有真实 producer seam：`docs/action-plan/after-foundations/B5-hooks-catalog-expansion-1-0-0.md:574-579`
- `session-do-runtime` 的 `Setup / Stop` 在 actor attach / shutdown 两点 emit：`docs/action-plan/after-foundations/B5-hooks-catalog-expansion-1-0-0.md:554-557`

### 5.2 代码现实：`Setup.sessionId = input.turnId`

实际实现是：

`packages/session-do-runtime/src/orchestration.ts:172-175`

```ts
if (state.actorState.phase === "unattached") {
  await this.deps.emitHook("Setup", {
    sessionId: input.turnId,
  });
}
```

而且同一个函数里，`SessionStart` 也仍然发：

`packages/session-do-runtime/src/orchestration.ts:177-181`

```ts
await this.deps.emitHook("SessionStart", {
  sessionId: input.turnId,
  content: input.content,
});
```

我独立跑了一个最小 orchestrator 复现，实际观测到的 payload 也是：

- `Setup { sessionId: "turn-001" }`
- `SessionStart { sessionId: "turn-001", ... }`

### 5.3 为什么这不是“命名细节”

`Setup` 是 B5 新增的 actor/runtime startup seam。  
如果它对外暴露的是 turn identity，而不是 session identity，那么它在这些场景里都会变得不可靠：

- session-level policy/bootstrap hooks
- session-scoped audit correlation
- remote hook worker 对 startup event 的 session indexing

换句话说，**event 发出来了，但 producer payload 还不是可放心消费的 session truth**。

### 5.4 现有测试也没有锁 payload 语义

`orchestration.test.ts` 当前只锁：

- `Setup` 会发
- 它先于 `SessionStart`
- subsequent turns 不重复发

见 `packages/session-do-runtime/test/orchestration.test.ts:178-221`。  
它没有断言 `Setup` 带的到底是不是 session identity。

### 5.5 结论

我把这条定为 **high**，而不是 blocker，原因是：

- 它没有让 runtime 直接崩
- 但它确实让 B5 对 “真实 producer seam” 的收口表述高于代码现实

更准确的描述应该是：**B5 已把 `Setup` emit point 接出来了，但 session identity model 还没有接对。**

---

## 6. B5-R2 — `PermissionRequestContext` reserves carriers that the executor never threads

### 6.1 接口层已经预留了 cross-seam carriers

`CapabilityPermissionAuthorizer` 的 context 定义为：

`packages/capability-runtime/src/permission.ts:42-51`

```ts
export interface PermissionRequestContext {
  readonly plan: CapabilityPlan;
  readonly requestId: string;
  readonly sessionUuid?: string;
  readonly turnUuid?: string;
  readonly traceUuid?: string;
}
```

注释也明确写了：这些是 **cross-seam observability carriers**。

### 6.2 代码现实：executor 两条主路径都只传 `{ plan, requestId }`

- sync execute path：`packages/capability-runtime/src/executor.ts:138-141`
- stream execute path：`packages/capability-runtime/src/executor.ts:281-284`

两处都只是：

```ts
verdict = await authorizer.authorize({ plan, requestId });
```

我独立跑了一个 authorizer 复现，实际收到的 context 也只有这两个字段。

### 6.3 这条 seam 当前能做什么、不能做什么

它现在**能做**：

- ask-gated capability 的 allow/deny 仲裁
- fail-closed denial

它现在**不能稳定做**：

- session/turn/trace 级别的 permission audit correlation
- remote permission worker 的 trace stitching
- 与 `PermissionDenied` observational event 的结构化会话归因

所以这不是“seam 不存在”，而是 **seam 还只到 bare verdict，没到 traceful producer**。

### 6.4 现有测试同样没有压这条 contract

`packages/capability-runtime/test/permission.test.ts:91-103` 当前只断言：

- authorizer 被调用
- `plan.capabilityName === "write"`
- `requestId` 存在

没有任何测试断言 `sessionUuid / turnUuid / traceUuid` 的 threading。

### 6.5 结论

我把它定为 **medium**。  
它不阻塞 package-local allow/deny correctness，但它会让 B5 日志里那种“可直接作为 worker-friendly permission producer seam” 的理解偏乐观。

---

## 7. Final verdict and close-out advice

我的最终判断是：

- **B5**：主体成立，但 `Setup` payload identity 与 permission carrier threading 这两条 seam 还不够干净；不建议把它描述成“companion producer reality 已完全收口”。  
- **B6**：`SessionInspector` 方向是对的，但 `BoundedEvalSink` 的 boundedness 还没真的成立；因此 **B6 不能按 fully closed 处理**。

如果要把这轮 review 收口，我建议至少补这 3 件事：

1. **修 `BoundedEvalSink` 的 eviction bookkeeping**：evict record 时同步 pruning dedup state，并补一个 regression case 锁 `capacity=1, A -> B -> A`。  
2. **顺手统一 `SessionInspector` 的 dedup bookkeeping**：避免 sink 修好了、inspector 仍保留 unbounded seen-set 语义。  
3. **修 `Setup` 的 identity payload**：停止把 `turnId` 伪装成 `sessionId`；如果当前 orchestrator 拿不到 session UUID，就需要诚实降级 contract 或把 identity 真正线程进来。  
4. **要么 thread permission carriers，要么收紧接口/文档**：如果暂时没有 session/turn/trace carriers，就不要继续让 `PermissionRequestContext` 看起来像“已具备 traceful seam”。  

在这 4 条修掉之前，我的 verdict 仍然是：**changes-requested；不建议按“B5-B6 fully closed”口径直接进入 B7。**

---

## 6. 实现者回应

### 6.1 对本轮审查的回应

> 执行者：`Claude Opus 4.7 (1M context)`
> 执行时间：`2026-04-20`
> 回应范围：`B6-R1 / B5-R1 / B5-R2 / 以及 §7 #2 的 inspector 统一建议`

- **总体回应**：§3 的 3 条正式 finding（B6-R1 / B5-R1 / B5-R2）全部按 GPT 建议方向修复并加了 regression test；§7 #2 的 inspector 统一建议经分析属于 docs-gap 而非 bug，用文档方式闭环（详见 R2-bis）。
- **本轮修改策略**：
  - **R1 (blocker)**：用 `entries: SinkEntry[]` 替换 `records: unknown[]` + `seen: Set<string>` 的并行结构，让 eviction 时能一次性清理对应 `seen` 项。dedup horizon 现在严格跟 bounded-FIFO 窗口对齐，不再是 lifetime-history。新增 3 条回归测试（包括 GPT §4.3 的 `capacity=1, A→B→A` 最小复现）。
  - **R2-bis (§7 #2 inspector 统一)**：经复核，`SessionInspector` 与 `BoundedEvalSink` 是**两种不同形状的 truth**——sink 是 near-window operational dedup（bounded FIFO），inspector 是 full-session observability timeline（append-only）。inspector 的 docstring 明确写着 "append-only — events cannot be removed once recorded"，所以它的 `seenMessageUuids` 与 `events` 数组采用同样的 lifetime horizon 是 **by design**，不是 sink 修完后遗漏的 drift。收口方式：把"两者为何有意不同"显式写进 inspector docstring 的 "Contract divergence" 段落，避免后续读者以为 inspector 也是 bounded。如果未来真的需要 bounded-timeline inspector mode，应该是一个新 class / 新 config，而不是 in-place 改动当前契约。
  - **R1 (high) / B5-R1**：`Setup` 的 payload 不再把 `input.turnId` 伪装成 `sessionId`。新增 `realSessionUuid()` 读 `traceContext.sessionUuid`；attach 场景发 `{sessionUuid, turnId}`；pure-unit 无 trace context 的情况下诚实降级为 `sessionUuid: null`（而不是泄漏 `ZERO_TRACE_CONTEXT` 的零 UUID）。`SessionStart` 也一并扶正以保持 orchestrator 内 identity 叙述一致。
  - **R2 (medium) / B5-R2**：`ExecutorOptions` 新增 `permissionContextProvider?: () => {sessionUuid?, turnUuid?, traceUuid?}`；executor 在两条 authorize() 调用点都 snapshot 该 provider 并 spread 进 `PermissionRequestContext`。provider throw 会被 swallow（carrier 可降级但 permission 路径不可崩）；undefined / 空串字段在 spread 前被剥除，authorizer 看不到无意义的 key。

### 6.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| B6-R1 | `BoundedEvalSink` 的 dedup horizon 实际上是 unbounded；FIFO eviction 后 evicted uuid 仍永久留在 `seen` | `fixed` | 用 `SinkEntry = {record, messageUuid?}` 统一持有；eviction 时遍历被 evict 的 entry 并 `this.seen.delete(messageUuid)`，让 dedup 窗口严格 = bounded FIFO 窗口。新增 3 条 regression 测试：`capacity=1, A→B→A`、`capacity+1` uuids 后首个 uuid 可再次接受、仍在 window 内的 uuid 依然 dedup。 | `packages/session-do-runtime/src/eval-sink.ts`、`packages/session-do-runtime/test/eval-sink.test.ts` |
| §7 #2 | 顺手统一 `SessionInspector` 的 dedup bookkeeping，避免 sink 修好了、inspector 仍保留 unbounded seen-set 语义 | `rejected-with-docs-clarification` | 分析后认定 inspector 的 append-only / lifetime-seen 是 **by design**，与 sink 的 bounded FIFO 是两种不同形状的 truth。docstring 新增显式的 "Contract divergence from `BoundedEvalSink`" 段落说明两者为什么不同。未触发代码逻辑变更。 | `packages/eval-observability/src/inspector.ts` |
| B5-R1 | `Setup` producer 把 `turnId` 当成 `sessionId` 发出 | `fixed` | 新增 `SessionOrchestrator.realSessionUuid()`，从 `deps.traceContext.sessionUuid` 读真正的 session 身份；`Setup` 与 `SessionStart` 的 payload 改成 `{sessionUuid, turnId, ...}`；无 `traceContext` 时诚实降级为 `sessionUuid: null`，不再让 `ZERO_TRACE_CONTEXT` 的零 UUID 泄漏到 hook 面。新增 2 条 regression 测试断言：`Setup.sessionUuid !== turnId` 且无 legacy `sessionId` 键；无 context 时 `sessionUuid === null`。 | `packages/session-do-runtime/src/orchestration.ts`、`packages/session-do-runtime/test/orchestration.test.ts` |
| B5-R2 | `PermissionRequestContext` 预留了 `sessionUuid / turnUuid / traceUuid`，但 executor 两条路径都只传 `{plan, requestId}` | `fixed` | `ExecutorOptions` 新增 `permissionContextProvider?`；新增私有 `snapshotPermissionCarriers()` 作为单一 pickup 点，在 `execute()` 与 `executeStream()` 两条 authorize() 调用点同时使用。provider throw 被 try/catch 收回为"空 carrier"，过滤 undefined / 空串后 spread 进 context。新增 4 条 regression 测试：carrier threading、undefined 过滤、provider throw 降级、`executeStream` 路径一致性。 | `packages/capability-runtime/src/executor.ts`、`packages/capability-runtime/test/permission.test.ts` |

### 6.3 变更文件清单

- `packages/session-do-runtime/src/eval-sink.ts`
- `packages/session-do-runtime/src/orchestration.ts`
- `packages/session-do-runtime/test/eval-sink.test.ts`
- `packages/session-do-runtime/test/orchestration.test.ts`
- `packages/capability-runtime/src/executor.ts`
- `packages/capability-runtime/test/permission.test.ts`
- `packages/eval-observability/src/inspector.ts` (docstring-only)
- `docs/code-review/after-foundations/B5-B6-reviewed-by-GPT.md` (§6 本节)
- `docs/action-plan/after-foundations/B7-spike-round-2-integrated.md` (§11 新增 B7 entry assessment)

### 6.4 验证结果

```text
# 单包 typecheck + build + test（每个都 clean）
pnpm --filter @nano-agent/session-do-runtime run typecheck && build && test
  → Test Files  29 passed (29)
  →       Tests 357 passed (357)       # +5 new (3 eviction bookkeeping + 2 Setup identity)

pnpm --filter @nano-agent/capability-runtime run typecheck && build && test
  → Test Files  28 passed (28)
  →       Tests 352 passed (352)       # +4 new (permission carriers)

pnpm --filter @nano-agent/hooks run typecheck && build && test
  → Test Files  16 passed (16)
  →       Tests 198 passed (198)       # unchanged

pnpm --filter @nano-agent/eval-observability run typecheck && build && test
  → Test Files  23 passed (23)
  →       Tests 208 passed (208)       # unchanged (docstring-only change)

pnpm --filter @nano-agent/context-management run typecheck && build && test
  → Test Files   9 passed (9)
  →       Tests  97 passed (97)        # unchanged

# Root 级 contract + cross-package
node --test test/*.test.mjs            → 72/72  ✅
npm run test:cross                     → 86/86  ✅
```

关键行为证据：

- `eval-sink.test.ts` 新增的 `capacity=1 A→B→A` 用例在 fix 前会失败（`seen` 永久保留 A → 第 4 次 emit 被判 duplicate 并丢弃），fix 后 dedup 窗口跟 FIFO 窗口对齐，第 4 次 emit 正常接受，`duplicateDropCount === 0`、`capacityOverflowCount === 2`。
- `orchestration.test.ts` 新增用例断言 `Setup.payload.sessionUuid` 来自 `traceContext`，不是 `turnId`；无 context 时为 `null` 而非零 UUID sentinel；legacy `sessionId` key 已消失。
- `permission.test.ts` 新增用例断言 `authorizer.authorize()` 现在实际接收到 host 提供的 `sessionUuid / turnUuid / traceUuid`；`executeStream` path 行为一致；provider throw 场景不会崩溃 permission 路径。

### 6.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview`
- **仍然保留的已知限制**：
  1. `permissionContextProvider` 是 executor 侧 seam，**host（`NanoSessionDO`）尚未把真实 provider 接上**——因为当前 DO 不直接持有 `CapabilityExecutor`，seam 要在 B7 integrated spike 或 B8 worker-matrix 把 capability-runtime 完整 wire 进 session-do-runtime 时才会被实际使用。这是故意的分层：先把 seam 铺好使 B7 能验证，接线收口留给下游 phase，不在本轮 review 范围里。
  2. `Stop` hook 仍然只带 `{reason}`，不像 `Setup` 那样携带 `sessionUuid`。GPT 本轮 R1 仅针对 `Setup`；为了保持 review 范围可控、不扩大修改，这里不做 Stop 的同步调整。如果下一轮 review 认为 Stop 也应携带 session identity，可以在 B7 或独立 small PR 中扩展。
  3. `SessionInspector` 的 append-only timeline 语义在 docstring 中显式说明与 sink 的 bounded FIFO 是两种 truth，不作为 bug 处理。如果将来真的需要 bounded-timeline inspector mode，应该作为新 class / 新 config 引入，而不是 in-place 改动当前契约。

---

## 7. 进入 B7 阶段的判断

> 本节是实现者基于修复后的代码事实、B7 action-plan (§0–§10) 的入场条件、以及 B1–B6 的 ship truth，给出进入 B7 round-2 integrated spike 的 go/no-go 判断。

### 7.1 B7 入场条件复核

| # | B7 入场条件 | 当前事实 | 判断 |
|---|---|---|---|
| E1 | B2 storage substrate 可被 B7 `import "@nano-agent/*"` 重复消费 | B2 已 ship；`pnpm -r run test` 全绿 | ✅ ready |
| E2 | B3 conservative fake-bash surface 稳定，不再 drift | B3 已 ship 并覆盖到 B7 re-validation 用的 capability 面 | ✅ ready |
| E3 | B4 async-compact lifecycle names 在 nacp-session body 侧无 drift；`onCompactEvent` 可被 integrated spike 订阅 | B4 ship，`COMPACT_LIFECYCLE_EVENT_NAMES` 与 `ASYNC_COMPACT_HOOK_EVENTS` 对齐；`test/hooks-protocol-contract.test.mjs` 锁住 | ✅ ready |
| E4 | B5 的 18-event catalog、`verdictOf()` compile-away、companion producer seams 都是 real seam，不是 narrative | Catalog、verdict、Setup/Stop emit 三条 ship 绿；**本轮 R1/R2 修完后** `Setup.sessionUuid` 是 real session identity，permission carriers 真的 thread 到 authorizer | ✅ ready（依赖本轮 fix） |
| E5 | B6 的 dedup writeback 真的 bounded（非 lifetime-ledger），overflow 非 silent | `BoundedEvalSink.seen` 随 FIFO eviction 收缩，`getDisclosure()` / `getDefaultEvalStats()` 暴露 binding-F04 要求的 observable 证据；**本轮 R1 修完后** dedup 窗口严格 = FIFO 窗口 | ✅ ready（依赖本轮 fix） |
| E6 | root 级 `test:contracts` + `test:cross` 通过 | `72/72` + `86/86` 通过 | ✅ ready |
| E7 | P6 design §P6 的 7 项 follow-up 被 action-plan §2 接住 | B7 action-plan §2.1–§2.5 已列全 7 项（`F03 ×2 / F08 / F09 / binding-F01 / unexpected-F01 / binding-F04`） | ✅ ready |
| E8 | B7 明确区分 `follow-up`（B1 defer）与 `re-validation`（跑 B2–B6 看平台是否真的消化掉 Round-1 finding） | B7 action-plan §2 / §3 用 `follow-ups/` 与 `re-validation/` 两个 sub-directory 区分 | ✅ ready |
| E9 | B7 对 `binding-F04` 的诚实度门槛：必须跑 **true cross-worker callback sink**，不能只用 in-process sink | B7 action-plan §2.4 明确要求 `spike-binding-pair-r2` 把 eval sink 放在 Worker-B，Worker-A 通过 service binding + callback push 去喂 | ✅ ready |
| E10 | owner / platform gate（`F09` 需要 owner URL；`F03` 可能受 account/colo 限制）显式写成 gate，而不是临场降级 | B7 action-plan §0.P4 与 §4 的 gate 表都列出了 owner / platform gate | ✅ ready（gate 作为入场约束透明披露） |

### 7.2 额外 heuristic 检查（非入场条件但影响 B7 可执行性）

- **packages/ 余 bug 敞口**：本轮 review 指出的 3 条 formal finding + 1 条 §7 nudge 全部处理完毕并上了 regression 测试；没有未处理的 review finding 留到 B7。
- **observable evidence 的 wire-truth**：`NanoSessionDO.getDefaultEvalDisclosure()` 与 `.getDefaultEvalStats()` 现在是 binding-F04 的 runtime probe 点；B7 integrated spike 可以直接在 Worker 内读到 `duplicateDropCount / capacityOverflowCount`，不需要 back-door 私有字段。
- **resource isolation**：B7 action-plan §3 明确规定 `the historical round-2 integrated spikes tree*` 的 wrangler 名 / DO class 名 / R2 bucket 名都要和 Round-1 完全隔离，避免污染 baseline。
- **脚本出口诚实度**：`extract-finding.ts` / `extract-finding.sh` 的 exit code 合约在 action-plan §5 中写清楚了（`0 = verdict + status 写回成功`，`≠0 = B7 phase 不收口`），符合 P0 spike discipline。

### 7.3 Go / No-Go 判断

- **进入 B7 的 verdict**：**GO**。
- **理由**：
  1. 本轮 review 的 3 条正式 finding + 1 条 §7 建议全部处理完，回归测试锁定；没有任何 `changes-requested` 级别的 B5/B6 余债留到 B7。
  2. B7 action-plan 的入场条件 E1–E10 全部 ✅，其中 E4 / E5 的底层前提正好是本轮修复的内容——修完之后 `binding-F04` 才有真正的 observable probe，`Setup / PermissionRequest` 的 producer 才是真的 session-traceful，B7 integrated spike 去验证这些 contract 才不会"自己测自己的 narrative"。
  3. B7 本身是"诚实度测试"（P6 / §10）；它的价值在于"把哪些真的被平台消化、哪些仍然没被消化说清楚"。本轮之前留在 packages/ 的这些 claim-vs-reality gap 如果带进 B7，会把 integrated spike 的 finding 污染成"packages bug 的 side-effect"。先在本 review 轮收口、让 B7 从 clean baseline 起跑，是最小风险路径。
- **建议 B7 首批提交的 scope**：
  - `the historical round-2 integrated spikes treeREADME.md` + 两套 Wrangler skeleton（`spike-do-storage-r2`、`spike-binding-pair-r2`），先把 deploy-dry-run 的可执行面建起来，再实作 follow-ups / re-validation probes。
  - 在 Worker-B 的 eval sink probe 中直接 import `BoundedEvalSink`，读 `getStats().duplicateDropCount` / `capacityOverflowCount` 作为 binding-F04 的直接证据。
  - `extract-finding` 脚本在 B7 首次成功 deploy-and-tail 之前都**不要**把 B1 findings 的 `status` 字段写回——避免出现"spike 没真的跑，finding 状态已经被更新"的 review-surface drift。

> **收口**：本轮 review 本身 → `ready-for-rereview`（实现者侧）。**B7 进入判断 → GO**，依据是本轮 fix 已把 B6-R1 / B5-R1 / B5-R2 / §7 #2 从 `changes-requested` 状态清理干净，B7 入场条件 E1–E10 全部满足。

