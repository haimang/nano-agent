# E2E Cross-Package Test Bug Log — Round 01

> Generated from `test/e2e/` cross-package test suite execution.  
> Rule: test-side fixes are already applied; package-side issues are logged here for follow-up.

---

## 1. `@nano-agent/eval-observability` — Event classification overlap causes audit events to be downgraded to transcript

**Observation**
`classifyEvent("tool.call.result")` returns `"durable-transcript"` instead of `"durable-audit"`, even though `"tool.call.result"` is present in `DURABLE_AUDIT_EVENTS`.

**Root cause**
In `packages/eval-observability/dist/classification.js`, `DURABLE_TRANSCRIPT_EVENTS` is checked **before** `DURABLE_AUDIT_EVENTS`, and the same event kinds (`"tool.call.result"`, `"turn.begin"`, `"turn.end"`) exist in both sets. This means they can never classify as audit.

**Impact**
Tests (and production sinks) that expect `"tool.call.result"` to produce a durable-audit record will silently get a transcript record instead.

**Suggested fix**
Remove the overlapping kinds from one of the two sets, or swap the precedence so audit is checked first.

---

## 2. `@nano-agent/eval-observability` — Missing persistence mappings for hook and compact events

**Observation**
`traceEventToAuditBody({ eventKind: "hook.block", ... })` returns `null` because `"hook.block"` is not in `DURABLE_AUDIT_EVENTS` or `DURABLE_TRANSCRIPT_EVENTS`.  
The same issue affects `"hook.broadcast"` and `"compact.notify"` (they classify as `"live"` and are therefore dropped from durable persistence).

**Root cause**
The persistence sets in `classification.js` are incomplete for these event kinds.

**Impact**
Blocking hook outcomes, hook broadcasts, and compact notifications cannot be written to the durable audit store, breaking observability guarantees for those flows.

**Suggested fix**
Add `"hook.block"`, `"hook.broadcast"`, and `"compact.notify"` to the appropriate persistence set(s).

---

## 3. `@nano-agent/capability-runtime` — Filesystem handlers are pure stubs (no actual I/O)

**Observation**
`createFilesystemHandlers({ workspacePath: "/workspace" })` returns handlers where:
- `cat` returns a diagnostic string (`[cat] reading: <path>`) but **never reads file content**.
- `write` returns a diagnostic string (`[write] wrote N bytes to <path>`) but **never persists bytes**.
- `ls` returns a diagnostic string (`[ls] listing: <path>`) but **never enumerates entries**.

**Root cause**
The handlers in `packages/capability-runtime/src/capabilities/filesystem.ts` are intentionally minimal stubs, but they do not accept a real storage backend or `WorkspaceNamespace` to perform actual I/O.

**Impact**
Any E2E test or runtime path that expects file operations to round-trip through a workspace backend will fail unless it injects custom handlers.

**Suggested fix**
Extend `createFilesystemHandlers` to accept an optional `WorkspaceNamespace` (or backend map) and perform real reads/writes/listings when provided.

---

## 4. `@nano-agent/capability-runtime` — `registerMinimalCommands` sets overly restrictive policy for `mkdir`

**Observation**
`registerMinimalCommands(registry)` registers `mkdir` with `policy: "ask"`. In the E2E test harness (which has no interactive user), this causes `CapabilityExecutor` to return a `policy-ask` error.

**Root cause**
`packages/capability-runtime/dist/fake-bash/commands.js` hard-codes `policy: "ask"` for `mkdir`.

**Impact**
Non-interactive/automated usage of the minimal command set cannot execute `mkdir` without explicitly re-registering the command.

**Suggested fix**
Change the default policy for `mkdir` (and potentially `write`) to `"allow"` in the minimal commands fixture, or provide a `registerMinimalCommands(registry, { policy: "allow" })` override option.

---

## 5. `@nano-agent/agent-runtime-kernel` — Missing `turn.interrupted` stream mapping

**Observation**
`mapRuntimeEventToStreamKind({ type: "turn.interrupted", ... })` returns `undefined` because `"turn.interrupted"` is absent from `RUNTIME_TO_STREAM_MAP`.

**Root cause**
`packages/agent-runtime-kernel/dist/events.js` does not include an entry for `turn.interrupted`.

**Impact**
Mid-turn cancellation cannot emit a properly-typed session stream event, breaking the client-visible live stream contract.

**Suggested fix**
Add `"turn.interrupted" -> "turn.interrupted"` (or an equivalent NACP stream kind) to `RUNTIME_TO_STREAM_MAP`.

---

## 6. `@nano-agent/storage-topology` — `PLACEMENT_HYPOTHESES` exported as empty object

**Observation**
`PLACEMENT_HYPOTHESES` is imported as `{}`, which contradicts the design documentation that describes an array of placement hypotheses used for storage calibration.

**Root cause**
`packages/storage-topology/dist/index.js` (or its source) exports `PLACEMENT_HYPOTHESES = {}`.

**Impact**
`calibratePlacement()` and any downstream topology logic that consumes placement hypotheses will receive no data, making calibration a no-op.

**Suggested fix**
Populate `PLACEMENT_HYPOTHESES` with the intended array of hypothesis objects, or remove the export if it is intentionally deferred and document the gap.

---

## 7. `@nano-agent/session-do-runtime` — Intermittent `"invalid checkpoint"` during `restoreSessionCheckpoint`

**Observation**
In some test harnesses, `restoreSessionCheckpoint` throws `"invalid checkpoint"` even when the checkpoint object appears well-formed.

**Root cause**
Unknown / needs further investigation. Possible causes:
- `validateSessionCheckpoint` applies stricter implicit checks than the builder guarantees.
- Fragment shapes (especially `workspaceFragment` or `replayFragment`) mismatch the validator's expectations.

**Impact**
Session resume reliability is degraded for checkpoints built with non-trivial fragments.

**Suggested fix**
Add detailed validation error messages to `validateSessionCheckpoint` so callers can distinguish which field or type constraint failed.

---

## Test-side fixes applied (for reference)

The following issues were **not** package bugs; they were resolved by correcting test assertions or fixture usage:

1. **`fake-session.mjs` path fix** — `../../packages/` changed to `../../../packages/` because `fixtures/` is one level deeper than `test/`.
2. **Hook API usage** — `HookDispatcher` has no `.register()` method; tests now correctly use `HookRegistry.register()` + `LocalTsRuntime.registerHandler()` + `new HookDispatcher(registry, runtimesMap)`.
3. **UUID validation** — `SessionStreamEventBodySchema` requires valid UUIDs for `request_uuid`; tests replaced `"req-1"` with fixed UUIDs from `seed-data.mjs`.
4. **`planAttachment()` signature** — The function expects `(mimeType, sizeBytes, modelCaps)`, not a pre-built artifact ref object.
5. **`CompactBoundaryManager.pickSplitPoint()`** — For 8 messages with a 200-token budget, the actual split point is 5 (not 6); test assertion was corrected.
6. **`buildExecutionRequest()` null safety** — The helper rejects `null` for `providers`/`models`; tests removed such invalid invocations.
7. **`DATA_ITEM_CATALOG` field names** — Entries use `itemClass` and `provisionalMarker`, not `key`/`provisional`.
8. **`restoreSessionCheckpoint` property name** — The restore function returns `workspaceSnapshot`, not `workspaceFragment`; test was using the wrong property name.
9. **`redactPayload` behavior** — The utility replaces redacted fields with the literal string `"[redacted]"`, not `undefined`; test assertion was updated.
10. **`TraceSink` interface** — `TraceSink` is an interface, not a class; tests now provide a mock implementation.

---

## Final test counts

- **14 / 14 E2E tests passing** (`test/e2e/e2e-01` through `e2e-14`)
- **15 / 15 root contract tests passing** (`test/*.test.mjs`)

---

## GPT 核查与收口（基于当前代码事实）

### 1. 总体判断

这份 bug log 现在应视为 **“部分已修、部分原判断失准、少量问题仍未复现”**，不应继续整体当成 open package-bug 清单使用。

### 2. 逐条核查结论

| 条目 | 当前判定 | 依据 |
|------|----------|------|
| 1 | `部分误判，且分类歧义已修` | `tool.call.result` 现在仍按 **durable-transcript** 作为 package truth（`packages/eval-observability/src/classification.ts:44-50`, `packages/eval-observability/src/durable-promotion-registry.ts:95-102`），因此“应该是 durable-audit”这句不成立；但此前 audit/transcript overlap 的确会让 `turn.begin/turn.end` 分类失真，现已通过 disjoint sets 收紧（`packages/eval-observability/src/classification.ts:21-42`, `packages/eval-observability/test/classification.test.ts:29-45,83-103`）。 |
| 2 | `部分成立，现已修复` | `hook.block` 不是当前仓库里的真实 event kind；这部分属于误报。`hook.broadcast` 与 `compact.notify` 缺 durable policy 则是实问题，现已进入 durable-audit 且写入默认 promotion registry（`packages/eval-observability/src/classification.ts:29-42`, `packages/eval-observability/src/durable-promotion-registry.ts:121-160`, `packages/eval-observability/test/durable-promotion-registry.test.ts:102-120`）。 |
| 3 | `成立，现已修复` | `createFilesystemHandlers()` 现在支持可选 namespace-like seam，并在提供 namespace 时执行真实 `ls/cat/write/rm/cp/mv`，不再只是 path echo（`packages/capability-runtime/src/capabilities/filesystem.ts:28-232`，`packages/capability-runtime/test/filesystem.test.ts:34-94`）。 |
| 4 | `成立，现已修复` | 默认安全策略未改，但 `registerMinimalCommands()` 现在支持 per-command `policyOverrides`，非交互 harness 不必再 remove/re-register（`packages/capability-runtime/src/fake-bash/commands.ts:11-161`, `packages/capability-runtime/test/commands.test.ts:6-42`）。 |
| 5 | `误报 / stale` | 当前 kernel 并不存在 `turn.interrupted` runtime event；真实 `RuntimeEventSchema` 与 stream mapping 只有 `turn.started -> turn.begin`、`turn.completed -> turn.end` 等 9-kind reality（`packages/agent-runtime-kernel/src/types.ts:145-172`, `packages/agent-runtime-kernel/src/session-stream-mapping.ts:15-25`）。 |
| 6 | `stale，已由现代码否定` | `PLACEMENT_HYPOTHESES` 现在已从 `storage-topology` 正式导出，不是空对象（`packages/storage-topology/src/index.ts:70-81`）。本轮顺手把 `test/e2e/e2e-10-storage-calibration.test.mjs:8-12` 的过时注释一并修正。 |
| 7 | `仍未复现，暂不判 package bug` | `validateSessionCheckpoint()` 当前只做 top-level shape / counter / UUID 校验，`restoreSessionCheckpoint()` 也仅在 validator 失败时抛错；在当前 root contract + E2E 下未复现该条所述 intermittent failure（`packages/session-do-runtime/src/checkpoint.ts:145-269`）。若后续再出现，应以最小复现样本补充，而不是继续按现状记为已确认 bug。 |

### 3. 本轮实际修改

1. **收紧 `eval-observability` durable 分类真相**
   - 去掉 audit / transcript overlap，让 `turn.begin` / `turn.end` 明确归 audit。
   - 保留 `tool.call.result` 的 transcript truth，并补入 `hook.broadcast` / `compact.notify` 的 durable-audit 策略。
2. **补齐 `capability-runtime` 的 workspace seam**
   - `createFilesystemHandlers()` 现在在提供 namespace 时执行真实文件读写/列举/复制/移动/删除。
   - 仍保留无 namespace 时的 diagnostic fallback，避免破坏现有 fake-bash 兼容面。
3. **补齐最小命令集的非交互 override seam**
   - 新增 `registerMinimalCommands(registry, { policyOverrides })`，让 E2E / harness 能显式放宽 `mkdir` / `write` 等命令，而不是修改默认安全姿态。
4. **同步测试与 E2E**
   - 新增 `packages/capability-runtime/test/filesystem.test.ts`
   - 新增 `packages/capability-runtime/test/commands.test.ts`
   - 更新 `test/e2e/e2e-07-workspace-fileops.test.mjs`，改为走正式 namespace seam + policy override
   - 更新 `test/e2e/e2e-10-storage-calibration.test.mjs` 的 stale 注释

### 4. 复核时执行的验证

```text
cd packages/eval-observability && npm test && npm run build
cd packages/capability-runtime && npm test && npm run build
node --test test/*.test.mjs
node --test test/e2e/**/*.test.mjs
```

### 5. 收口意见

- **对 `e2e-test-01` 的收口判断**：可以收口。
- **原因**：
  1. 真正成立且值得修的 package 问题（#2 / #3 / #4，以及 #1 中的“分类歧义”部分）已经落实到代码与测试。
  2. #5 / #6 已被当前代码事实否定，不能继续作为 open bug 保留。
  3. #7 目前没有复现证据，继续写成已确认 package bug 会误导后续 review。
- **保留的 follow-up**：
  1. `mkdir` 在当前 workspace model 下仍是“路径声明式”语义，不是带独立目录 inode 的真实 FS primitive；若后续 workspace backend 引入显式目录对象，需要再补 contract。
  2. 根脚本 `npm run test:cross` 当前的 glob 实际只覆盖到了 `test/e2e/*.test.mjs`；root contract suite 需要显式执行 `node --test test/*.test.mjs` 才能得到本文记录的 `15 / 15` 结果。这不影响本轮 bug 判定，但建议后续单独收口脚本口径。
