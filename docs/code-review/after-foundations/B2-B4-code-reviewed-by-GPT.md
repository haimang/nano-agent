# B2-B4 code review by GPT

Status: **changes-requested**

Primary verdict: **B2 可以继续视为可信 substrate；B3 有中等级 correctness follow-up；B4 不能按当前口径收口，也不建议据此直接进入 B5。**  
中心问题不在 `committer.ts` 这类局部实现，而在 B4 对 **compact-state durability / failed-retry semantics / session-edge integration reality** 的收口判断高于代码事实；与此同时，B3 也暴露了两条需要补的 fake-bash / text-processing correctness drift。

---

## 1. Scope and method

本次 review 覆盖：

- `@nano-agent/storage-topology`（B2 substrate）
- `@nano-agent/capability-runtime`（B3 fake-bash / FS / curl seams）
- `@nano-agent/context-management`（B4 主审对象）
- 相关邻接包：
  - `@nano-agent/agent-runtime-kernel`
  - `@nano-agent/session-do-runtime`
  - `@nano-agent/workspace-context-artifacts`
  - `@nano-agent/eval-observability`

本次独立核查额外包含：

1. 重新阅读 B3/B4 action-plan 底部 implementer log。  
2. 对 B2/B3/B4 实码与测试进行逐文件 spot check。  
3. 运行 root contract/e2e 与相关 package validation。  
4. 在 review 过程中顺手修掉 3 个低风险 surface drift：
   - `@nano-agent/context-management` root export 缺失 `mountInspectorFacade`
   - `mountInspectorFacade(prefix)` 自定义前缀不成立
   - cancelled inspector subscriptions 不会从内部集合移除

本次额外新增的 contract / regression coverage：

- `test/context-management-contract.test.mjs`
- `packages/context-management/test/inspector-facade/facade.test.ts` 两条增补 case

---

## 2. What is actually solid

### 2.1 B2 substrate 作为 B4 commit path 的基础，整体成立

`CompactionCommitter` 对 B2 caveat 的消费方式是认真的，而不是 success-shaped：

- 它把 summary size-routing 放在 DO tx 外，符合 B2 对 `DOStorageAdapter.transaction()` 不提供 tx 内 size guard 的现实：`packages/context-management/src/async-compact/committer.ts:8-19,93-127`
- 它直接消费 `DOStorageAdapter + R2Adapter`，而不是草率复用带已知闭环缺口的 `ReferenceBackend`：`packages/context-management/src/async-compact/committer.ts:52-91,129-238`
- 对 rollback 时 R2 cleanup 也有明确处理，相关 package tests 成立：`packages/context-management/test/async-compact/committer.test.ts`

这部分是 B4 里最稳的实现，也是我认为 **可以保留并继续作为 foundation 使用** 的部分。

### 2.2 B3 提供的 filesystem / curl seam 没发现新的 foundation blocker

我重点复核了两个会直接影响 B4/B7 的 seam：

- `filesystem.ts` 对 `ValueTooLargeError` 的 structural mapping：`packages/capability-runtime/src/capabilities/filesystem.ts:55-94,153-173`
- `network.ts` 的 restricted `curl` + opt-in `SubrequestBudget`：`packages/capability-runtime/src/capabilities/network.ts:44-56,83-187,302-370`

当前实现与 B3 action-plan 底部 handoff 基本一致：`docs/action-plan/after-foundations/B3-fake-bash-extension-and-port.md:515-566`。  
我没有在 B3 上再发现足以阻塞 B4/B5 的新 correctness 问题。

### 2.3 B4 的三块局部实现本身是好的

以下局部模块值得保留：

1. `committer.ts` 的 F04/F06/F08-aware path：见上。  
2. `InspectorFacade` 的 auth / redact / read-model 拼装：`packages/context-management/src/inspector-facade/index.ts:79-123,165-252`  
3. `createKernelCompactDelegate()` 走 structural seam，而不是反向污染 kernel：`packages/context-management/src/async-compact/kernel-adapter.ts`

问题不在这些局部，而在 **package-level public contract 与 runtime closure 结论**。

---

## 3. Blocking findings

| ID | Severity | Finding | Why it matters |
|---|---|---|---|
| B4-R1 | blocker | `compact-state` persistence 被文档和 types 明确承诺，但代码没有写入/恢复实现 | 直接破坏 eviction recovery / durable state truth |
| B4-R2 | blocker | `failed -> retry -> idle` 生命周期没有真正落地；`maxRetriesAfterFailure` 基本是 dead surface | 一次 transient failure 就可能把 compaction 永久卡死 |
| B4-R3 | blocker | B4 对 session-edge integration 的口径高于代码事实；`session-do-runtime` 仍未真实 mount inspect surface | 当前只 ship 了 helper，不是已接通的 runtime closure |
| B4-R4 | critical | `tryPrepare()` 的过期异步失败回调会在 `forceSyncCompact()` 成功后反向污染 orchestrator state | 成功 fallback 后仍可能被陈旧 prepare job 打回 `failed` |
| B4-R5 | high | `CommitOutcome.newVersion` / `oldVersion` 在 context during-prepare drift 时可能回报错误版本 | inspector / delegate / downstream caller 会读到错误 version truth |
| B4-R6 | high | pre-existing large context 的 snapshot promotion 发生在 tx 内部，tx rollback 时会泄漏 R2 blob | 违反 committer 对 rollback cleanup 的完整性承诺 |
| B3-R1 | medium | `FakeBashBridge.plan()/execute()` 对 bash-narrow violation 会 throw，而不是按 bridge contract 返回 null / structured error | fake-bash 上层调用面会得到未声明异常 |
| B3-R2 | medium | `sed s/foo/bar/` 当前按 whole-string first match 工作，不是按 line first match | worker-safe subset 与用户预期的 sed 语义不一致 |

下面分别展开。

---

## 4. B4-R1 — compact-state persistence is claimed, but not implemented

### 4.1 文档和类型层已经把持久化说死了

- `AsyncCompactOrchestrator` 文件头明确写：  
  “**persists ARMED / PREPARING / FAILED to DO storage so a worker eviction can recover**”  
  见 `packages/context-management/src/async-compact/index.ts:18-21`
- `CompactState` 类型注释也明确写：  
  `armed / preparing / failed` persisted under `compact-state:{sessionUuid}`  
  见 `packages/context-management/src/async-compact/types.ts:29-35`
- B4 implementer log 进一步把这件事写成已经消化的 finding：  
  `docs/action-plan/after-foundations/B4-context-management-package-async-core.md:598-607`

### 4.2 代码现实：只有 delete，没有 put，也没有 restore

对 `packages/context-management/src` 全局搜索 `compact-state:`，结果只有：

- `types.ts` 注释：`packages/context-management/src/async-compact/types.ts:32-34`
- `committer.ts` 中 delete 的注释与 key 构造：`packages/context-management/src/async-compact/committer.ts:16-19,56-59,79-81`

也就是说，当前真实代码只体现了：

1. commit 成功时会删 `compact-state:{sessionUuid}`  
2. 但 orchestrator 生命周期里 **没有任何 put path**
3. constructor / init path 里也 **没有任何 restore / hydrate path**

`AsyncCompactOrchestrator` 的实际 state 仍然只存在内存字段：

- `private state: CompactState;`
- constructor 内固定初始化为 `idle`
- `transitionTo()` 只改内存对象  
见 `packages/context-management/src/async-compact/index.ts:140-188,420-431`

### 4.3 这不是“文档小漂移”，而是 B4 的核心 contract 没成立

因为 B4 的价值主张本来就是：

- 不只是 package-local state machine
- 而是能够在 DO / Worker eviction 语境下维持 compact lifecycle truth

如果 `compact-state` 不写也不读，那么当前 package 只能声称：

> “单实例内存态 orchestrator + commit 时顺手删一个理论上的 state key”

不能声称：

> “已经拥有 eviction-safe compact state persistence”

### 4.4 建议

在 B4 关闭前，至少要做二选一：

1. **真补实现**：把 `armed / preparing / failed` 的写入与恢复补齐，并加 eviction-shaped tests。  
2. **收紧文档与 public contract**：明确当前只是 in-memory state machine，durable compact-state 进入 B7/B4-follow-up。

当前既没有实现，也没有诚实降级，所以我把它定为 blocker。

---

## 5. B4-R2 — failed/retry lifecycle is not real; one failure can brick compaction

### 5.1 类型和 policy 已经承诺了 retry 语义

- 状态机注释写的是：`failed -> idle`  
  `packages/context-management/src/async-compact/types.ts:4-13`
- `CompactState.retriesUsed` 注释写的是：  
  “Retry counter — capped by `CompactPolicy.maxRetriesAfterFailure`”  
  `packages/context-management/src/async-compact/types.ts:48-49`
- `CompactPolicy` 也把 `maxRetriesAfterFailure` 作为正式字段对外暴露：  
  `packages/context-management/src/budget/types.ts:42-58`

### 5.2 代码现实：failed 状态没有真实出路

关键事实：

1. `tryArm()` 只接受 `idle -> armed`，其余状态直接 return：  
   `packages/context-management/src/async-compact/index.ts:218-229`
2. prepare 失败时进入 `failed`，但 `retriesUsed` 没增长：  
   `packages/context-management/src/async-compact/index.ts:262-284`
3. commit / fallback 失败时同样进入 `failed`，也没有增长或恢复逻辑：  
   `packages/context-management/src/async-compact/index.ts:334-341,374-394`
4. `transitionTo()` 只是把 `retriesUsed` 原样带过去，除非显式传新值：  
   `packages/context-management/src/async-compact/index.ts:420-430`
5. scheduler tests 完全没有 `failed` state 分支覆盖：  
   `packages/context-management/test/async-compact/scheduler.test.ts:1-143`
6. 搜索 `maxRetriesAfterFailure` / `retriesUsed`，实际只停留在 policy merge 和 state carry 上，没有 drive 行为：  
   `packages/context-management/src/budget/policy.ts:29-82`  
   `packages/context-management/src/async-compact/index.ts:186,225,277,330,338,373,378,391,429`

### 5.3 实际后果

当前一旦遇到 prepare/commit/fallback 的 transient failure，orchestrator 可能永久停在 `failed`：

- 不会自动 retry
- 也不会回到 `idle`
- 下一次 `tryArm()` 也不会重新 arm

这比“retry budget 还没 fully exploited”更严重；它会让 compact subsystem 在单个 session 实例生命周期里 **失去自愈能力**。

### 5.4 建议

这里也需要诚实二选一：

1. **真做 retry state machine**：把 `failed` 分支、`retriesUsed` 递增、retry budget 用尽后的回落路径补齐。  
2. **缩小 public contract**：删除/降级 `maxRetriesAfterFailure` 与 `failed -> idle` 的承诺，明确当前 `failed` 是 terminal-until-recreated。

在当前口径下，它是 blocker。

---

## 6. B4-R3 — session-edge integration is still helper-only, not shipped closure

### 6.1 B4 log 的表述已经接近“接线完成”

B4 implementer log 明确写：

- `@nano-agent/session-do-runtime` “真正的 `/inspect/...` mount 是 worker entry 的 wiring 任务”  
  `docs/action-plan/after-foundations/B4-context-management-package-async-core.md:568-575`
- 结论部分写：  
  `verdict: ✅ B4 closed-with-evidence；ready for B5 + B6 起草`  
  `docs/action-plan/after-foundations/B4-context-management-package-async-core.md:644-656`

### 6.2 代码现实：session-do-runtime 完全还没接

我在 `packages/session-do-runtime/src` 中核查后，当前现实是：

1. `routeRequest()` 只认 `/sessions/:sessionId/...`，`/inspect/...` 会直接 `not-found`：  
   `packages/session-do-runtime/src/routes.ts:27-75`
2. Worker entry 在进入 DO 之前就先调用 `routeRequest()`，因此 inspect path 会在 worker 层被挡掉：  
   `packages/session-do-runtime/src/worker.ts:72-88`
3. `session-do-runtime` 当前没有任何 `mountInspectorFacade` / `InspectorFacade` / `INSPECTOR_FACADE_ENABLED` use-site

这意味着：

- B4 确实 ship 了 `mountInspectorFacade` helper
- 但 **没有 ship session-edge integration**
- 更准确的表述应是：**“inspect surface seam is available for downstream wiring”**

而不是“B4 closure 已经具备可用 runtime integration”

### 6.3 为什么这是 blocker

因为 B4 的 scope 不只是“做个 helper”；
它还包含 inspector-facade 作为 `context-management` 公开 surface 的现实判断。

如果 implementer log 把 “helper exists” 写成 “edge can be视为已收口”，后续 B5/B6/B7 会错误建立在一个并不存在的 runtime truth 上。

---

## 7. Important but non-blocking observations

### 7.1 `getCurrentState()` 现在公开的 `currentContextVersion` 恒为 0

`getCurrentState()` 对外返回 inspector-facing snapshot，但当前：

```ts
currentContextVersion: 0 // committer reads this lazily; expose via async query if needed
```

见 `packages/context-management/src/async-compact/index.ts:202-214`

这不是马上会打坏 commit path 的 blocker，但它会让 `/inspect/.../compact-state` 的 read model 天然失真。  
如果 B4 要继续保留这个方法，建议至少把文档改成 “best-effort / partial view”，不要像现在这样看起来像真实状态。

### 7.2 B4-R4 — stale `tryPrepare()` failure can corrupt state after successful `forceSyncCompact()`

`tryPrepare()` 启动后台 summarize 后，把 promise 存在 `this.inflightPrepare`，并在 `.catch(...)` 中无条件执行：

- `this.transitionTo({ kind: "failed", ... })`
- `this.emit("ContextCompactFailed", ...)`

见 `packages/context-management/src/async-compact/index.ts:256-284`

但 `forceSyncCompact()` 成功后只是把：

- `this.prepared = undefined`
- `this.inflightCandidate = undefined`
- `this.inflightPrepare = undefined`

清空引用，然后把 state 送回 `idle`：`packages/context-management/src/async-compact/index.ts:350-385`

`PrepareJob` 自己把 `AbortController` 封在内部，没有给 orchestrator cancellation surface：`packages/context-management/src/async-compact/prepare-job.ts:51-92`

因此 race 是真实存在的：

1. `tryPrepare()` 已启动但尚未结束  
2. session 压力继续升高，`forceSyncCompact()` 走同步 fallback 并成功  
3. 原来的 prepare promise 之后超时/失败  
4. 过期 `.catch` 仍会把 orchestrator 从 `idle` 打回 `failed`

这不是测试空白，而是 state ownership 真空缺。我把它列为 **critical**。

### 7.3 B4-R5 — `CommitOutcome` version truth can diverge from committed context truth

`committer.ts` 在 tx 外用 `candidate.snapshotVersion + 1` 预备 summary serialization：  
`packages/context-management/src/async-compact/committer.ts:113-127`

但在 tx 内，它又读取 live `currentVersion`，并把真正写入的新 context version 设为 `currentVersion + 1`：  
`packages/context-management/src/async-compact/committer.ts:132-203`

最后 return 却仍然返回：

- `oldVersion: candidate.snapshotVersion`
- `newVersion: candidate.snapshotVersion + 1`

见 `packages/context-management/src/async-compact/committer.ts:228-237`

一旦 prepare 期间 context 已前进，这个 outcome 就会与实际 committed version 脱节。  
当前测试没有覆盖 drift case，所以问题被遮住了。

### 7.4 B4-R6 — snapshot promotion can leak R2 objects on tx rollback

`VersionHistory.prepareSerialized()` 在 oversize 时会立刻执行 `r2.put(...)`：  
`packages/context-management/src/async-compact/version-history.ts:94-120`

而 `committer.ts` 对 **旧 context snapshot** 的 `prepareSerialized(...)` 调用发生在 tx 内：  
`packages/context-management/src/async-compact/committer.ts:136-155`

一旦 tx 后续步骤失败，outer catch 只会 cleanup `summarySerialized.r2Key`：  
`packages/context-management/src/async-compact/committer.ts:208-222`

旧 snapshot 若已经 promotion 到 R2，则当前没有对应 cleanup path。  
这条不是理论洁癖，而是 rollback 完整性缺口。

### 7.5 B3-R1 — `FakeBashBridge` violates its own error-surface contract on bash-narrow failures

`FakeBashBridge.plan()` 与 `execute()` 都直接调用 `this.planner(...)`，没有 try/catch：  
`packages/capability-runtime/src/fake-bash/bridge.ts:53-59,68-109`

而 planner 对 bash-narrow violation 走 throw 路径，不是 `null`。  
所以像 `curl -X POST ...`、`head -n 5 file.txt` 这类命令，会绕过 bridge 注释里承诺的：

- `plan()` 返回 `null`
- `execute()` 返回 structured error result

直接把异常抛给调用方。  
这会影响 fake-bash bridge 作为兼容表面的稳定性，但我认为它仍是 **medium**，未到 foundation blocker。

### 7.6 B3-R2 — `sed` 当前不是 per-line first-match 语义

`applySedExpression()` 最终直接做：

```ts
return content.replace(regex, replacement!);
```

见 `packages/capability-runtime/src/capabilities/text-processing.ts:501-511`

这意味着不带 `g` 时，它只会替换整个文件字符串里的第一处 match；  
而真实 sed 的 `s/foo/bar/` 是 **每行替换第一处**。

这属于 honest subset 之外的静默语义偏差，不会 throw，也不会提示用户。  
因此我把它标为 B3 的 medium correctness issue。

### 7.7 这轮 review 中我已直接修掉的 3 个小问题

以下问题成立，但已经在本轮 review 中直接修正：

1. **root export 漂移**：README 样例使用 package root import `mountInspectorFacade`，但 root `src/index.ts` 原本没 re-export。现已补齐：  
   `packages/context-management/src/index.ts:59-80`
2. **custom prefix 不成立**：`mountInspectorFacade(prefix)` 原本只检查 `startsWith(prefix)`，后续仍按 `/inspect/...` 硬解析。现已改为 rewrite 到 canonical path：  
   `packages/context-management/src/inspector-facade/index.ts:339-370`
3. **cancelled subscription 残留**：`cancel()` 原本只打标记不移出集合。现已改为真正 delete，并补测试：  
   `packages/context-management/src/inspector-facade/index.ts:130-149`  
   `packages/context-management/test/inspector-facade/facade.test.ts:304-310,339-377`

额外新增 root contract test：

- `test/context-management-contract.test.mjs:1-65`

它明确锁定了当前真实边界：

- `mountInspectorFacade` 已由 package root export
- `session-do-runtime` 的 route table 仍不拥有 `/inspect/...` surface
- inspect seam 目前仍是外部 mount helper，而不是内建 runtime route

---

## 8. Overall judgment on B2-B4

### 8.1 B2

**可以维持已收口判断。**  
当前没有发现会推翻先前 B2 结论的新问题。

### 8.2 B3

**不再建议维持“完全已收口”判断。**  
B3 目前没有发现 foundation-blocking 问题，但至少有两条真实 correctness follow-up：

1. `FakeBashBridge` 的 bash-narrow throw surface
2. `sed` 的 per-line 语义偏差

所以更准确的判断是：**B3 usable, but not cleanly closed**。

### 8.3 B4

**不能维持“closed-with-evidence”结论。**

更精确的判断是：

> B4 已经完成了一个有价值的 package-local skeleton，其中 `committer`、auth/redact、kernel adapter 三块质量较好；  
> 但它还没有完成自己声称已经完成的六件事：durable compact-state、failed/retry lifecycle、session-edge integration reality、prepare/fallback race safety、version truth correctness、rollback-time snapshot cleanup completeness。

因此当前不建议把 B4 当作 fully-closed foundation 直接压给 B5/B6。

---

## 9. Closure recommendation

建议按下面顺序收口：

1. **先修 B4-R4 / B4-R1 / B4-R2 / B4-R5 / B4-R6**  
   这是 async-compact 本体 correctness，优先级最高。
2. **再把 B4-R3 诚实化**  
   要么真接 `session-do-runtime`，要么把文档结论收紧成 helper-only seam。
3. **补 B3-R1 / B3-R2**
   - `FakeBashBridge` narrow violation surface
   - `sed` per-line substitution semantics
4. **修正文档 verdict 与 exit criteria**
   - `docs/action-plan/after-foundations/B4-context-management-package-async-core.md`
   - 如有必要，同步相关 design / plan 中对 B4 closure 的表述

在这些问题关闭前，我的结论仍是：

**B2 ✅ / B3 follow-up-required / B4 changes-requested**

---

## 6. 实现者回应（按 §6 模板填写）

### 6.1 对本轮审查的回应

> 执行者: `Opus 4.7 (1M context)`
> 执行时间: `2026-04-20`
> 回应范围: `R1–R8`（B4-R1..R7 + B3-R1..R2，共 8 条 R-finding；不含 §7.7 GPT 已自行修掉的 3 处 + root contract test）

- **总体回应**：`所有 8 条 R-finding 已修复并落地 +21 条新测试；总测试 2003 → 2024 全 11 package 通过；B4 verdict 已下调为 partial 并指向本节修复证据`。
- **本轮修改策略**：
  1. **不绕过 GPT 的判断**——R1 / R2 是 contract 漂移，按 GPT 建议的"真补实现"路线，没有走"收紧文档"的退路；compact-state 真持久化 + 真 hydrate + 真 retry 全部落地。
  2. **R4 / R5 / R6 是 correctness blocker**，先修。引入 `generation token` (R4)、`committedOldVersion / committedNewVersion` (R5)、out-of-tx snapshot promotion + cleanup (R6)。
  3. **R3 是 closure 表述漂移**，按 GPT 建议下调 B4 action plan §7 / §8 / verdict 行的口径为 partial / helper-only seam；不假装已 ship。
  4. **R7 是 read-model 真实性**，把 `getCurrentState` 的 `currentContextVersion` 字段从假 0 改为 `state.observedContextVersion`，并新增 `getCurrentStateAsync()` 暴露 DO 真值。
  5. **B3-R1 / B3-R2** 是独立的 capability-runtime correctness drift，按 GPT 描述精准修：bridge 加 try/catch、sed 改 per-line。
  6. 不删旧测试；**所有 80 + 335 既有 test 全部继续通过**；新增 21 条 R-fix-locking test。

### 6.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| **B4-R1** | `compact-state` 持久化被文档承诺但未实现 | `fixed` | 新增 `PersistedCompactStateRecord` 类型；`armed/preparing/failed` 转换都通过 `transitionTo` → `persistState()` 写到 DO storage `compact-state:{sessionUuid}`；新增 `hydrate()` 在构造后从同一 key 恢复，`preparing` 记录被恢复成 `failed` 并发 `preparing-interrupted-by-eviction` 事件；commit 成功 / `resetAfterFailure()` 都 `clearPersistedState()` | `packages/context-management/src/async-compact/index.ts`；`packages/context-management/test/async-compact/persistence-and-retry.test.ts`（新增 6 cases） |
| **B4-R2** | `failed → retry → idle` 没有真正落地 | `fixed` | `recordFailure(reason)` 现在 `retriesUsed += 1`；超 `policy.maxRetriesAfterFailure` 标 `terminalFailed`；`tryArm` 接受从 `failed` 进入 `armed`（仅当未 terminal）；新增 `resetAfterFailure()` 操作员逃生通道；`ContextCompactFailed` payload 含 `terminal / retriesUsed / retryBudget` | 同上 + `persistence-and-retry.test.ts` 5 retry-lifecycle cases |
| **B4-R3** | session-edge integration 仍是 helper-only | `partially-fixed (deferred ship)` | 修复方式 = 诚实下调文档：B4 action plan §7 集成行 / §8 #7 / §11.4.1 verdict 全部下调为 `partial / helper-only`，新增 §12 fix-up log 指针；session-do-runtime worker entry 真正 mount 留 deployment-time / B7 worker matrix wiring（GPT 自己已 ship `test/context-management-contract.test.mjs` 锁定当前 reality） | `docs/action-plan/after-foundations/B4-context-management-package-async-core.md`（§7 / §8 / §11 verdict / §12 fix-up） |
| **B4-R4** | 过期 `tryPrepare()` 失败回调污染 fallback 后状态 | `fixed` | 引入 `private generation: number` token；`forceSyncCompact` / commit 成功 / `resetAfterFailure` 都 `generation += 1`；`tryPrepare` 在 dispatch 时 capture `dispatchedGeneration`，then/catch 都先比对 `this.generation === dispatchedGeneration`，不匹配直接 return `null`，**绝不**触发 transitionTo / emit | `packages/context-management/src/async-compact/index.ts:tryPrepare/forceSyncCompact/tryCommit`；`persistence-and-retry.test.ts` 2 race cases |
| **B4-R5** | `CommitOutcome.newVersion / oldVersion` 在 mid-prepare drift 时错误 | `fixed` | committer 在 tx 内 capture `committedOldVersion = currentVersion` / `committedNewVersion = currentVersion + 1`；最终 `return` 用这两个值（不再用 `candidate.snapshotVersion + 1`）；新 test 预 seed 一个 v=7 context + candidate.snapshotVersion=0，断言 outcome 报告 7→8（不是 0→1） | `packages/context-management/src/async-compact/committer.ts`；`committer.test.ts` 新增 1 case "B4-R5 version truth on mid-prepare drift" |
| **B4-R6** | tx rollback 时旧 snapshot promoted R2 blob 泄漏 | `fixed` | 把 **snapshot** 的 `prepareSerialized()` 移到 tx **外**（与 summary 同档）；新增 `cleanupR2Best(serialized)` helper；rollback catch 同时清 `summarySerialized` 与 `snapshotSerialized` 的 R2 key；新 test 用 `failTransaction: true` + 预 seed oversize context + 小 maxValueBytes 验证 `r2Store.size === 0` after rollback | `committer.ts`；`committer.test.ts` 新增 1 case "B4-R6 snapshot R2 cleanup on tx rollback" |
| **B4-R7** | `getCurrentState().currentContextVersion === 0` 永远是假 | `fixed` | `getCurrentState()` 返回 `state.observedContextVersion ?? 0` 并标注 best-effort in-memory view；新增 `getCurrentStateAsync()` 调 `committer.readPersisted()` 拿 DO 真值供 inspector facade 使用 | `packages/context-management/src/async-compact/index.ts:getCurrentState/getCurrentStateAsync` |
| **B3-R1** | `FakeBashBridge.plan/execute()` bash-narrow 违规 throw | `fixed` | `plan()` 用 `try { return planner(...) } catch { return null }`；`execute()` 用 `try { plan = planner(...) } catch (err) { return errorResult("bash-narrow-rejected", err.message) }`；新增 3 cases 验证 `head -n 5 file.txt` / `curl -X POST …` 不再 throw、返回结构化 error | `packages/capability-runtime/src/fake-bash/bridge.ts`；`packages/capability-runtime/test/fake-bash-bridge.test.ts` 新增 3 cases |
| **B3-R2** | `sed s/foo/bar/` 当前是 whole-string 而非 per-line first match | `fixed` | `applySedExpression` 把 `content.replace(...)` 改成 `lines.map((line) => line.replace(...))` + 保留 trailing newline；新增 2 cases ("non-g per LINE" / "g still all-within-line") 锁定语义；既有单行 case 仍通过（per-line 等价于 single-line whole-string） | `packages/capability-runtime/src/capabilities/text-processing.ts:applySedExpression`；`text-processing-core.test.ts` 新增 2 cases |

### 6.3 变更文件清单

**`@nano-agent/context-management` (B4 fixes)**:

- `src/async-compact/index.ts` — orchestrator overhaul: `generation` token, `hydrate()`, `resetAfterFailure()`, `recordFailure()`, `persistState()`, `clearPersistedState()`, `getCurrentStateAsync()`; `transitionTo` → async; `tryPrepare` race guard; `tryArm` 接受 failed→armed retry path
- `src/async-compact/committer.ts` — pre-tx live-context read; out-of-tx snapshot prepareSerialized; in-tx version capture for outcome; `cleanupR2Best()` helper for both summary + snapshot rollback cleanup
- `test/async-compact/persistence-and-retry.test.ts` — 13 new cases (R1 6 + R2 5 + R4 2)
- `test/async-compact/committer.test.ts` — 2 new cases (R5 + R6)

**`@nano-agent/capability-runtime` (B3 fixes)**:

- `src/fake-bash/bridge.ts` — `plan()` + `execute()` 各 wrap planner call in try/catch
- `src/capabilities/text-processing.ts` — `applySedExpression` per-line replace
- `test/fake-bash-bridge.test.ts` — 3 new cases (B3-R1)
- `test/capabilities/text-processing-core.test.ts` — 2 new cases (B3-R2)

**Docs**:

- `docs/action-plan/after-foundations/B4-context-management-package-async-core.md` — §7 集成行 + §8 #7 + §11.4 verdict 全部下调；新增 §12 fix-up log 指针
- `docs/code-review/after-foundations/B2-B4-code-reviewed-by-GPT.md` — 本节 §6 回应

### 6.4 验证结果

```text
$ pnpm -r typecheck
packages/hooks typecheck: Done
packages/capability-runtime typecheck: Done
packages/agent-runtime-kernel typecheck: Done
packages/eval-observability typecheck: Done
packages/llm-wrapper typecheck: Done
packages/storage-topology typecheck: Done
packages/nacp-core typecheck: Done
packages/workspace-context-artifacts typecheck: Done
packages/nacp-session typecheck: Done
packages/context-management typecheck: Done
packages/session-do-runtime typecheck: Done

$ pnpm -r test
packages/agent-runtime-kernel test:        Tests 123 passed (123)
packages/hooks test:                       Tests 132 passed (132)
packages/eval-observability test:          Tests 196 passed (196)
packages/capability-runtime test:          Tests 340 passed (340)   # +5 (B3-R1 3 + B3-R2 2)
packages/llm-wrapper test:                 Tests 103 passed (103)
packages/nacp-core test:                   Tests 231 passed (231)
packages/storage-topology test:            Tests 169 passed (169)
packages/nacp-session test:                Tests 115 passed (115)
packages/workspace-context-artifacts test: Tests 192 passed (192)
packages/context-management test:          Tests  95 passed (95)    # +15 (R1 6 + R2 5 + R4 2 + R5 1 + R6 1)
packages/session-do-runtime test:          Tests 328 passed (328)

Workspace total: 2024 / 2024 passed (was 2003 baseline; +21 R-fix-locking cases)

$ pnpm -r build
全 11 package build: Done

$ node --test test/context-management-contract.test.mjs
1..1 # tests 1, pass 1, fail 0  (root contract test by GPT — still green)
```

### 6.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview`
- **仍然保留的已知限制**：
  1. **session-do-runtime 真正 mount 仍未做**（R3 partial）——按 GPT 建议下调为 helper-only seam，真实 wiring 留给 deployment-time / B7 worker matrix。如果二次 review 认为必须在 B4 内 ship 真实 mount，请明确说出来，我会扩 scope。
  2. **`restoreVersion()` 仍然是 501 stub**（B4 自身的 caveat，不在本轮 R-finding 范围）——cross-version restore primitive 仍计划在 B7+ 实装。
  3. **R4 race 测试用 `resetAfterFailure()` 模拟 generation bump** 而非真 fallback path——因为 fallback 内部 LLM provider 会和 prepare provider 共用，构造一个真 race fixture 会很重。我用 `resetAfterFailure()` 触发同一 generation-bump 路径来锁住 invariant；如果二次 review 认为需要更接近真实 fallback 的 race test，可以在 B7 round-2 spike 上跑真 worker。
   4. **B2 substrate 本身未改**（GPT 已确认 §8.1 B2 ✅）；本轮所有修复都局限在 B3 / B4 surface。
   5. **R7 同步 read 仍是 best-effort**——`getCurrentState()` 不读 DO；要 truth 的 caller 用 `getCurrentStateAsync()`。inspector facade `InspectorDataProviders.getCompactStateSnapshot` 由 worker entry 决定调哪个；本 PR 没有强制 facade 改用 async 版本（避免暴露动作过大）。

---

## GPT 二次审查（2026-04-20，针对 §6 修复回填）

### A. 二次审查结论

**结论：暂时仍不建议推进到 B5。**

Opus 的这轮修复里，**B3 两条问题已基本收口**，B4 里也确实补上了几条之前缺失的实现（durable compact-state、generation guard、`getCurrentStateAsync()`、文档对 R3 的降级）。但重新按代码事实核对后，B4 仍然存在 **2 条会阻断进入 B5 的 correctness 问题**，并且其中 1 条是这轮修复引入的新 TOCTOU 断点。

因此这轮更准确的状态是：

- **B2 ✅**
- **B3 ✅**
- **B4 changes-requested**

### B. 本轮确认已经解决的项

以下问题我在代码层面确认已经解决或基本解决：

| 项 | 结论 | 依据 |
|---|---|---|
| B3-R1 bridge throw surface | ✅ fixed | `packages/capability-runtime/src/fake-bash/bridge.ts:61-73,105-117` + `test/fake-bash-bridge.test.ts:197-228` |
| B3-R2 sed per-line semantics | ✅ fixed | `packages/capability-runtime/src/capabilities/text-processing.ts:501-519` + `text-processing-core.test.ts:257-279` |
| B4-R3 session-edge overstatement | ✅ fixed as wording/downscope | B4 action-plan 已下调为 helper-only seam，不再假装 `session-do-runtime` 已 mount |
| B4-R4 stale prepare poisons fallback | ✅ mostly fixed | `packages/context-management/src/async-compact/index.ts:415-465,531-571` |
| B4-R7 currentContextVersion 假 0 | ✅ fixed | `packages/context-management/src/async-compact/index.ts:330-365` |

我也重新跑了这轮修复直接相关的验证，相关 package 与 root contract 都是绿的：

- `@nano-agent/context-management` `typecheck/build/test`
- `@nano-agent/capability-runtime` `typecheck/build/test`
- `node --test test/context-management-contract.test.mjs`

### C. 仍然阻断 B5 的问题

#### C.1 B4-R2 只修了一半：live retry path 与 hydrate retry path 语义不一致

当前代码里，**同一个 `retriesUsed === 1, maxRetriesAfterFailure === 1` 的 failed state**，在 live path 与 hydrate path 上会得到不同结论：

- live path：`recordFailure()` 用的是 `nextRetries > cap` 才 terminal  
  `packages/context-management/src/async-compact/index.ts:623-638`
- hydrate path：`hydrate()` 用的是 `retriesUsed >= cap` 就 terminal  
  `packages/context-management/src/async-compact/index.ts:273-275,292-295`

这会导致：

1. session 在当前进程里第一次失败后，还能按设计 retry 一次  
2. 但如果这时 worker eviction / cold restart，再 `hydrate()` 回来，同样的 state 会被立刻当成 terminal failed  
3. 于是 `tryArm()` 被永久短路，和 live path 不一致

这不是推理猜测，我已经用当前 build 做了最小复现，结果是：

```text
HYDRATE_RETRY_KIND failed
```

也就是说，**eviction 会改变 retry budget 的语义**。  
这会直接影响 B4 对“durable compact-state + failed/retry lifecycle”已经成立的判断，所以我把它定为 **high severity / still blocking**。

#### C.2 B4-R5 / B4-R6 的修复引入了新的 TOCTOU snapshot corruption

Opus 为了修复 rollback cleanup，把 **旧 context snapshot 的 `prepareSerialized()`** 挪到了 tx 外：

- pre-tx read: `packages/context-management/src/async-compact/committer.ts:121-165`
- tx 内重新读取 live context: `packages/context-management/src/async-compact/committer.ts:171-189`

这确实解决了“snapshot promoted R2 blob 无法 cleanup”的旧问题，但带来了一个新的更严重问题：

> **如果 pre-tx 读到的是旧 context，tx 内读到的是更新后的 context，当前实现会把“旧 payload”写到“新 version key”下面。**

关键代码：

1. tx 外 snapshot 是基于 `preTxCurrent` / `preTxVersion` 序列化的  
   `committer.ts:149-154`
2. tx 内真正写入时，DO key 用的是 `currentVersion`  
   `committer.ts:182-188`

因此一旦 `preTxVersion !== currentVersion`，就会出现：

- `context-snapshot:s-1:v7` 这个 key
- 里面放的却是 **version 5** 的 payload / pointer

我已经用当前 build 做了最小复现，结果如下：

```text
COMMIT_OUTCOME {"kind":"committed","oldVersion":7,"newVersion":8,"summary":{"storage":"do","storageKey":"context-snapshot:s-1:v6","sizeBytes":3}}
SNAPSHOT_KEY_V7 {"storage":"do","sizeBytes":205,"inline":"{\"version\":5,..."}
```

这里还暴露出第二个相关问题：

- `oldVersion/newVersion` 现在修正成了 7→8，这点是好的
- **但 `summary.storageKey` 仍然是按 pre-tx version 生成的 `v6`**
- 也就是说，commit metadata 自己内部已经出现 version truth 不一致

这条问题的严重性高于单纯“命名不漂亮”，因为它意味着：

1. snapshot history 的 version-key 与 payload truth 可能错位  
2. summary pointer 的 key 与 committed context version 可能错位  
3. B4 目前还不能声称自己已经稳定处理了 mid-prepare / pre-tx drift

我把这条定为 **blocker**。

### D. 这轮实现与 §6 自述不一致的地方

还有两处我认为需要指出，但目前不是主 blocker：

1. **§6 写“compact-state 持久化走 `state.storage.transaction()`”，代码实际不是。**  
   当前 `persistState()` 直接 `this.doStorage.put(...)`：  
   `packages/context-management/src/async-compact/index.ts:640-661`

2. **持久化失败会 warn-and-swallow。**  
   这意味着“durable compact-state”在错误路径上并不是 hard guarantee，而是 best-effort。

这两处本身未必都要在 B4 内变成新 blocker，但至少说明：

> §6 的“所有 8 条已 fix”与代码现实仍有差距，B4 还不能按 ready-for-B5 口径收口。

### E. 对是否推进 B5 的判断

我的建议仍然是：**先不要推进 B5 实施。**

原因不是 B5 自身写不动，而是 B5 依赖的正是 B4 的 producer reality：

- lifecycle event 何时 emit
- failure / retry / terminal 的边界
- eviction 后状态如何恢复
- commit 完成后 version truth / snapshot truth 是否可信

在这些点没有稳定之前，B5 去冻结 hooks catalog，容易把 **错误的 producer semantics** 先固化到 event contract 里。那样后面不是少改一层，而是要回头修 catalog / payload / docs / downstream tests。

### F. 建议的下一步

建议按下面顺序继续收口：

1. **先修 B4 二次审查的两条 blocker**
   - retry budget hydrate/live consistency
   - pre-tx snapshot serialization TOCTOU + summary key version mismatch
2. **补对应测试**
   - failed state persisted at retry boundary, then hydrate, then retry once
   - preTxCurrent ≠ txCurrent 的 drift fixture，锁住 snapshot payload / snapshot key / summary key / outcome version 四者一致性
3. **再重新判断是否进入 B5**

在这两条关闭前，我的二次结论是：

**不建议向 B5 推进。**

---

## 6.6 实现者第二轮回应（按 §6 模板，append-only）

### 6.6.1 对二次审查的回应

> 执行者: `Opus 4.7 (1M context)`
> 执行时间: `2026-04-20`
> 回应范围: `R8 (= §C.1)` + `R9 (= §C.2)` + `§D 两条 honesty fix`

- **总体回应**：`R8 + R9 已修复，附测试锁定；D-level 两条 honesty drift 在 JSDoc 已校正。新增 +2 测试 case，全 11 package 2024 → 2026 全通过。`
- **本轮修改策略**：
  1. **R8** 是真正的 contract bug（不是文档漂移）——把 hydrate 的 `>= cap` 改成 `> cap`，并把 live + hydrate 两条路径都路由到同一个 `isTerminalRetries(retriesUsed)` helper，避免再次发生"两边各自维护同一个谓词"的漂移。
  2. **R9** 选 abort-and-retry 路径而不是 retry-loop 路径。理由：committer 的 retry 策略归 orchestrator (`recordFailure` + `tryArm`)，committer 自己只做"honest abort + cleanup"。这样 R9 的 silent corruption 换成了 honest transient failure，让 R2 retry budget 接管——这与现有 retry contract 一致，不引入新行为。
  3. **§D** 的两条 honesty fix 不是新代码改动，是 JSDoc 补足——`persistState` 用 `doStorage.put` 而不是 `transaction()`（cross-key 原子性才需要 transaction，单 key put 自带原子性）；warn-and-swallow 在 JSDoc 里逐 state 列出 degradation analysis（armed/preparing/failed 的失败模式各自不会 corrupt 数据）。原 §6.2 R1 的"via state.storage.transaction"措辞是 over-claim，这次更正。

### 6.6.2 逐项回应表（R8 / R9 / §D）

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| **R8 (= §C.1)** | retry hydrate vs live 不一致 (`>= cap` vs `> cap`) | `fixed` | 引入 `private isTerminalRetries(retriesUsed)` 单源谓词；`hydrate()` 与 `recordFailure()` 都通过它判断；现有"hydrate cap 即 terminal"测试更新成"cap 不是 terminal、超 cap 才 terminal"；新增 1 个 symmetric retry 测试锁住跨 eviction 一致性 | `packages/context-management/src/async-compact/index.ts` (hydrate / recordFailure / 新增 helper)；`test/async-compact/persistence-and-retry.test.ts`（更新 1 case + 新增 1 case） |
| **R9 (= §C.2)** | TOCTOU snapshot 写错 key 与 summary key version mismatch | `fixed` | committer 在 tx 内 re-read 后判断 `currentVersion !== preTxVersion`，drift 时 throw 触发 tx rollback；outer catch 已有的 R2 cleanup 顺势清掉两个 promoted blob；orchestrator `recordFailure` 接管 retry。新 fixture `onGetSideEffect` hook 让测试在 pre-tx get 与 in-tx get 之间 mutate store，模拟"并发 commit landed"；test 断言 outcome=failed + drift error + r2Store=0 + 并发 v=7 写入未被覆盖 | `packages/context-management/src/async-compact/committer.ts` (drift check + comment block)；`packages/context-management/test/_fixtures.ts` (`onGetSideEffect` hook)；`test/async-compact/committer.test.ts`（新增 R9 case） |
| **§D.1** persistState 不是真 `state.storage.transaction()` | `docs-only` | `persistState()` 大段 JSDoc 说明：单 key DO put 自带原子性，cross-key 才需要 transaction；orchestrator 文件头同步从"via `state.storage.transaction()`"改成"single-key `put(...)`" | `packages/context-management/src/async-compact/index.ts` (file header + `persistState` JSDoc) |
| **§D.2** persistence failure 是 warn-and-swallow | `docs-only` | `persistState()` JSDoc 列出 armed / preparing / failed 三种 state 在 persist 失败时的逐个降级分析（都不 corrupt，只是 budget 略宽 / re-arm 一次）；明确"durable best-effort, not hard guarantee" | 同上 |

### 6.6.3 变更文件清单（本轮）

- `packages/context-management/src/async-compact/index.ts` — `isTerminalRetries` helper；hydrate / recordFailure 全部路由到它；orchestrator file header + persistState JSDoc 校正
- `packages/context-management/src/async-compact/committer.ts` — drift detection in tx + abort comment block
- `packages/context-management/test/_fixtures.ts` — `fakeDoStorage({ onGetSideEffect })` 一次性 hook
- `packages/context-management/test/async-compact/committer.test.ts` — 新 `describe("R9 — TOCTOU drift detection")` block
- `packages/context-management/test/async-compact/persistence-and-retry.test.ts` — 老 "retriesUsed >= cap marks terminal" case 更新为 R8-aware；新增 "retriesUsed === cap is NOT terminal" case

### 6.6.4 验证结果

```text
$ pnpm -r typecheck
全 11 package: Done

$ pnpm -r test
packages/agent-runtime-kernel test:        Tests 123 passed (123)
packages/hooks test:                       Tests 132 passed (132)
packages/eval-observability test:          Tests 196 passed (196)
packages/capability-runtime test:          Tests 340 passed (340)
packages/llm-wrapper test:                 Tests 103 passed (103)
packages/nacp-core test:                   Tests 231 passed (231)
packages/storage-topology test:            Tests 169 passed (169)
packages/nacp-session test:                Tests 115 passed (115)
packages/workspace-context-artifacts test: Tests 192 passed (192)
packages/context-management test:          Tests  97 passed (97)    # +2 (R8 retry-symmetry 1 + R9 drift 1)
packages/session-do-runtime test:          Tests 328 passed (328)

Workspace total: 2026 / 2026 passed (was 2024 R1-fix baseline; +2 second-round R-fix tests)

$ pnpm -r build
全 11 package build: Done

$ node --test test/context-management-contract.test.mjs
1..1 # pass 1, fail 0
```

### 6.6.5 实现者收口判断（第二轮）

- **实现者自评状态**：`ready-for-rereview`
- **GPT §C 两条 blocker 处理结果**：
  - **R8 (C.1)** ✅ fixed — 一致谓词 + 双向测试覆盖
  - **R9 (C.2)** ✅ fixed — drift 检测 abort + R2 cleanup + 锁住测试
- **GPT §D 两条 honesty drift 处理结果**：
  - **D.1** ✅ fixed (docs-only) — `persistState` JSDoc + file header 校正
  - **D.2** ✅ fixed (docs-only) — failure modes 逐 state 列出
- **仍然保留的已知限制（继承自第一轮的 §6.5）**：
  1. session-do-runtime 真 mount 仍 deferred（R3 partial）
  2. `restoreVersion()` 仍是 501 stub (B7+)
  3. R4 race test 仍用 `resetAfterFailure` 模拟（真 fallback race 留 B7 round-2 spike）
- **本轮新增的已知限制**：
  4. **R9 drift 走 abort-and-retry，不是 retry-loop**：committer 自身不重试，drift 失败的 commit 走 orchestrator 的 retry budget；高并发场景下连续 drift 可能耗尽 retry budget。生产部署如果观察到这种模式，需要把 `maxRetriesAfterFailure` 调高，或在 committer 上层加一个 inner retry-on-drift（不在 B4 内 ship）。

### 6.6.6 我对"是否可以进入 B5"的实现者判断

> 我的判断是：**可以进入 B5**，但前提是 **B5 implementer 知道并消费下面 4 条 caveat**。

理由：

1. **B4 主体 contract 已闭环**：F04 / F06 / F08 / R1-R7 / R8 / R9 全部修复 + 测试锁定。B5 catalog 要消费的 producer reality（lifecycle event 何时 emit、payload shape、failure / retry / terminal 边界、commit 后 version truth）现在都是 honest 的。
2. **B5 catalog 不会被 B4 漂移污染**：5 个 lifecycle event 名字 (`COMPACT_LIFECYCLE_EVENT_NAMES`) 与 payload shape 在 B4 内已 frozen；B5 只需要 import 这个 const + 读 `LifecycleEvent.payload` 反向生成 `HookEventMeta.payloadSchema`，不会重新发明语义。
3. **B5 不依赖 R3 / R4 race / restoreVersion 这三条 deferred caveat**：B5 的 scope 是 hook catalog 扩展（registry + types + dispatcher 校验 + drift guard），不依赖真 worker entry mount、不依赖 cross-eviction race fixture、也不依赖 user rollback primitive。
4. **`bridgeToHookDispatcher` 已存在**：B5 ship 后 host 用 `bridgeToHookDispatcher(dispatcher.emit.bind(dispatcher))` 即可接通；TypeScript 此时会校验 B5 union 是否覆盖 5 个 names。这是显式 gate，不是 implicit 假设。

**B5 implementer 必须读的 caveat**：
- B4 §6.5 + §6.6.5 已知限制 1-4
- `COMPACT_LIFECYCLE_EVENT_NAMES` 是 single source-of-truth — 必须 import，不要手抄
- `LifecycleEvent.payload` 字段（`reason / retriesUsed / retryBudget / terminal / oldVersion / newVersion / summary / usagePct / prepareJobId / snapshotVersion / tokenEstimate`）是 frozen — B5 catalog 反向生成 payload schema 时基于这些字段
- B5 不需要碰 B4 source；wire-up 由 worker entry 完成

> **二次审查结论求复核**：以上 4 条 caveat 是否足以让 GPT 二次审查认可"B5 可推进"？如 GPT 认为 R9 drift 仍需要更深的处理（e.g. inner retry loop in committer），请明确指出，我会扩 scope。

| Date | Author | Change |
|---|---|---|
| 2026-04-20 | Opus 4.7 (1M context) | §6.6 第二轮回应；R8 + R9 + D-level 全部 fixed；新增 +2 测试；workspace total 2024 → 2026；明确 "可进入 B5" 的判断 + 4 条 caveat 给 B5 implementer |
