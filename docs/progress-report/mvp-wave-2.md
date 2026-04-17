# MVP Wave 2 Progress Report

> Wave: `Wave 2 — Phase 2 for kernel/storage/eval/workspace + Phase 2-3 for hooks`
> 起点文档: `docs/investigation/action-batch-final-reviewed-by-opus.md` §2.3 Wave 2
> 执行者: `Claude Opus 4.6 (1M context)`
> 执行时间: `2026-04-16`
> 状态: `completed`

---

## 1. 工作安排起点

本次 Wave 2 执行依据 `docs/investigation/action-batch-final-reviewed-by-opus.md` §2.3 的定义：

> **Wave 2 — 基础设施 Phase 2 + kernel Phase 2：storage key/ref builders、eval sink/timeline、hooks registry/dispatcher/runtime、kernel reducer/scheduler/runner、workspace mount/namespace/backends。**

Exit Criteria（引用自终审报告）：
> kernel 可用 fake delegates 跑通 step loop；eval 可落 durable trace；storage key/ref builders 可被其他包消费。

涉及 5 个包：
- `agent-runtime-kernel` Phase 2：reducer / scheduler / interrupt / runner
- `storage-topology` Phase 2：key builders / ref builders / scoped-io adapter
- `eval-observability` Phase 2：sink / audit codec / DO-storage sink / timeline
- `hooks` Phase 2 + Phase 3：registry / matcher / dispatcher / runtimes / guards / core-mapping
- `workspace-context-artifacts` Phase 2：mount router / namespace / backends

---

## 2. 工作产出目录

### 2.1 总体统计

| 维度 | 数值 |
|------|------|
| 新增/修改源文件 | 55 (.ts in src/) |
| 新增测试文件 | 17 (.ts in test/) |
| 源代码行 | 4,091 |
| 测试代码行 | 2,523 |
| 测试用例总数 | **208** |
| Typecheck 通过率 | 5/5 (100%) |
| Test 通过率 | 208/208 (100%) |

### 2.2 agent-runtime-kernel Phase 2（4 new files + 4 test files, 49 tests）

| 文件 | 内容 | 参考来源 |
|------|------|---------|
| `src/reducer.ts` | `KernelAction` discriminated union (10 actions) + `applyAction()` pure reducer with phase guards | `context/codex/codex-rs/core/src/state/turn.rs` (state transition patterns) |
| `src/scheduler.ts` | `SchedulerSignals` + `scheduleNextStep()` with priority: cancel > timeout > compact > tools > llm > finish | `context/codex/codex-rs/core/src/codex.rs:343-514` (turn loop while-step pattern) |
| `src/interrupt.ts` | `classifyInterrupt()` + `canResumeFrom()` for recoverable/non-recoverable interrupt handling | `context/mini-agent/mini_agent/agent.py:90-121` (_check_cancelled pattern) |
| `src/runner.ts` | `KernelRunner.advanceStep()` — step-driven runner, NOT blackbox runTurn() | Kernel design doc: "Session DO 驱动 kernel step loop，不是 runTurn() 单函数黑盒" |

**Tests**: reducer (23 tests covering all 10 action types + illegal transitions), scheduler (9 tests for all signal combos), interrupt (11 tests for all InterruptReasons), runner (6 tests with fake delegates including full lifecycle).

### 2.3 hooks Phase 2-3（7 new files + 4 test files, 34 tests）

| 文件 | 内容 | 参考来源 |
|------|------|---------|
| `src/registry.ts` | `HookRegistry` with source-layered priority (platform-policy > session > skill), register/unregister/lookup | `context/claude-code/utils/hooks.ts` (hook registration model) |
| `src/matcher.ts` | `matchEvent()` — exact / wildcard / toolName matching, NO regex | `context/claude-code/utils/hooks.ts` (matcher semantics, not regex implementation) |
| `src/dispatcher.ts` | `HookDispatcher.emit()` — single entry point; blocking events execute sequentially with short-circuit, non-blocking in parallel | `context/claude-code/utils/hooks.ts` (PreToolUse blocking pattern) |
| `src/guards.ts` | `withTimeout()` + `checkDepth()` safety guards | — |
| `src/runtimes/local-ts.ts` | `LocalTsRuntime` — trusted in-process handler execution | — |
| `src/runtimes/service-binding.ts` | `ServiceBindingRuntime` — stub for cross-worker hook execution (wired in session-do) | `packages/nacp-core/src/messages/hook.ts` (hook.emit/hook.outcome protocol) |
| `src/core-mapping.ts` | `buildHookEmitBody()` / `parseHookOutcomeBody()` — hook domain ↔ nacp-core mapping | `packages/nacp-core/src/messages/hook.ts` (HookEmitBodySchema/HookOutcomeBodySchema) |

**Tests**: registry (10 tests for priority/source ordering), matcher (9 tests for all match types), dispatcher (7 tests for blocking/non-blocking/error), guards (8 tests for timeout/abort/depth).

### 2.4 eval-observability Phase 2（4 new files + 4 test files, 42 tests）

| 文件 | 内容 | 参考来源 |
|------|------|---------|
| `src/sink.ts` | `TraceSink` interface — `emit(event)` + `flush()` | — |
| `src/audit-record.ts` | `traceEventToAuditBody()` / `auditBodyToTraceEvent()` codec with truncation | `packages/nacp-core/src/messages/system.ts` (AuditRecordBodySchema) |
| `src/sinks/do-storage.ts` | `DoStorageTraceSink` — append-only JSONL per-session, uses `shouldPersist()` to gate durable promotion | `context/codex/codex-rs/rollout/src/recorder.rs:74-81` (JSONL append pattern) |
| `src/timeline.ts` | `SessionTimeline` — sorted event access with filterByKind/filterByTurn/getTimeRange | — |

**Tests**: sink (5 tests), audit-record (13 tests for encode/decode/roundtrip/truncation), timeline (13 tests for sorting/filtering), do-storage (11 tests with fake storage including durable/live classification gating).

### 2.5 storage-topology Phase 2（3 new files + 2 test files, 31 tests）

| 文件 | 内容 | 参考来源 |
|------|------|---------|
| `src/keys.ts` | `DO_KEYS` (7 static + 3 dynamic) / `KV_KEYS` (4 tenant-prefixed) / `R2_KEYS` (5 deep-hierarchy) | `docs/design/storage-topology-by-opus.md` §7.3 (Key Schema Constants) |
| `src/refs.ts` | `StorageRef` + `buildR2Ref()` / `buildKvRef()` / `buildDoStorageRef()` / `validateRefKey()` | `packages/nacp-core/src/envelope.ts` (NacpRefSchema with tenant constraint) |
| `src/adapters/scoped-io.ts` | `ScopedStorageAdapter` interface + `NullStorageAdapter` | `packages/nacp-core/src/tenancy/scoped-io.ts` (tenantR2*/tenantKv*/tenantDoStorage*) |

**Tests**: keys (15 tests for static values + dynamic generation + tenant prefix), refs (16 tests for building + validation + tenant enforcement).

### 2.6 workspace-context-artifacts Phase 2（5 new files + 3 test files, 52 tests）

| 文件 | 内容 | 参考来源 |
|------|------|---------|
| `src/backends/types.ts` | `WorkspaceBackend` interface — read/write/list/stat/delete | `context/just-bash/src/fs/interface.ts` (IFileSystem interface pattern) |
| `src/backends/memory.ts` | `MemoryBackend` — in-memory Map storage with path normalization and UTF-8 size | `context/just-bash/src/fs/in-memory-fs/in-memory-fs.ts` (InMemoryFs pattern) |
| `src/backends/reference.ts` | `ReferenceBackend` — stub for future durable/KV/R2 connection | — |
| `src/mounts.ts` | `MountRouter` — longest-prefix matching, partial segment safety | `context/just-bash/src/fs/mountable-fs/mountable-fs.ts:182-221` (routePath() algorithm) |
| `src/namespace.ts` | `WorkspaceNamespace` — unified file operations routing through MountRouter with readonly enforcement | — |

**Tests**: mounts (14 tests for longest-prefix/partial-segment/normalization), namespace (18 tests for CRUD/readonly/multi-mount), memory backend (20 tests for CRUD/listing/stat/multibyte).

---

## 3. 代码审查与测试结果

### 3.1 Typecheck 结果

| 包 | `tsc --noEmit` | 状态 |
|----|---------------|------|
| agent-runtime-kernel | PASS | ✅ |
| hooks | PASS | ✅ |
| eval-observability | PASS | ✅ |
| storage-topology | PASS | ✅ |
| workspace-context-artifacts | PASS | ✅ |

### 3.2 Test 结果

| 包 | Test Files | Tests | 状态 |
|----|-----------|-------|------|
| agent-runtime-kernel | 4 passed | 49 passed | ✅ |
| hooks | 4 passed | 34 passed | ✅ |
| eval-observability | 4 passed | 42 passed | ✅ |
| storage-topology | 2 passed | 31 passed | ✅ |
| workspace-context-artifacts | 3 passed | 52 passed | ✅ |
| **Total** | **17 passed** | **208 passed** | ✅ |

### 3.3 Exit Criteria 验证

| Exit Criteria | 验证方式 | 状态 |
|--------------|---------|------|
| kernel 可用 fake delegates 跑通 step loop | `test/runner.test.ts` — full lifecycle test: start → llm → tool → finish | ✅ |
| eval 可落 durable trace | `test/sinks/do-storage.test.ts` — emit → readTimeline roundtrip, live-only events correctly dropped | ✅ |
| storage key/ref builders 可被其他包消费 | `test/keys.test.ts` + `test/refs.test.ts` — key schema + ref validation with tenant enforcement | ✅ |

### 3.4 关键设计决策验证

| 决策 | 代码体现 | 验证 |
|------|---------|------|
| reducer 是单一状态转移入口 | `applyAction()` 是唯一改变 KernelSnapshot 的函数 | ✅ 23 tests |
| scheduler 优先级: cancel > timeout > compact > tools > llm > finish | `scheduleNextStep()` signal priority chain | ✅ 9 tests |
| runner 是 step-driven 不是 blackbox runTurn() | `KernelRunner.advanceStep()` returns per-step | ✅ 6 tests |
| hooks dispatcher 是唯一发射入口 | `HookDispatcher.emit()` orchestrates everything | ✅ 7 tests |
| blocking hooks 可 short-circuit on block/stop | dispatcher sequentially executes blocking events | ✅ dispatcher test |
| eval: live-only events not durably persisted | `DoStorageTraceSink` uses `shouldPersist()` gate | ✅ do-storage test |
| eval: audit codec roundtrip fidelity | `traceEventToAuditBody` → `auditBodyToTraceEvent` | ✅ 13 tests |
| storage: all keys tenant-scoped | `validateRefKey()` enforces `tenants/{team_uuid}/` | ✅ 16 tests |
| workspace: longest-prefix mount routing | `MountRouter.routePath()` matches deepest mount | ✅ 14 tests |
| workspace: readonly mounts reject writes | `WorkspaceNamespace.writeFile()` throws on readonly | ✅ namespace test |

---

## 4. 下一步工作分析

### 4.1 Wave 3 范围（引用自终审报告 §2.3）

Wave 3 — 子系统 Phase 3-5 + session-do P2-P3（约 2-3 周）：

| 包 | Phase | 内容 |
|----|-------|------|
| kernel P3-P5 | event mapping / checkpoint / scenario tests | 对齐 nacp-session 9 kinds + checkpoint fragment + fake delegate scenarios |
| llm P2-P5 | registry / adapter / executor / normalizer / session mapping | 完整 LLM 执行链路 |
| capability P2-P5 | planner / fake-bash / policy / targets / commands | 完整 capability 执行链路 |
| workspace P3-P5 | artifacts / prepared / context / compact / snapshot | artifact model + context assembler + compact boundary |
| hooks P4-P5 | session mapping / audit / snapshot / integration | nacp 映射 + audit + snapshot/restore |
| eval P3-P5 | inspector / runner / replay / evidence / attribution | 消费工具链 |
| storage P3-P5 | placement / checkpoint / calibration | provisional placement 正式化 |
| session-do P2-P3 | WS/HTTP ingress / actor lifecycle / health | Session DO 骨架 |

### 4.2 Wave 3 前置条件

| 前置条件 | 状态 |
|---------|------|
| Wave 2 全部 5 包 typecheck 通过 | ✅ |
| Wave 2 全部 208 tests 通过 | ✅ |
| kernel step loop 可运行 | ✅ (runner.test.ts) |
| eval durable trace 可落盘 | ✅ (do-storage.test.ts) |
| storage key/ref builders 可消费 | ✅ (keys/refs tests) |
| workspace mount/namespace 可操作 | ✅ (namespace tests) |
| hooks dispatcher 可发射 | ✅ (dispatcher tests) |

**结论：Wave 3 所有前置条件已满足，可以立即启动。**

---

## 5. 收口分析

### 5.1 累计产出（Wave 0 + Wave 1 + Wave 2）

| Wave | 包数 | 源文件 | 测试文件 | 源代码行 | 测试代码行 | Tests |
|------|------|--------|---------|---------|-----------|-------|
| Wave 0 (nacp-core + nacp-session) | 2 | ~40 | ~15 | ~3,000 | ~1,500 | 313 |
| Wave 1 (8 packages Phase 1) | 8 | 48 | 0 | 2,580 | 0 | 0 |
| Wave 2 (5 packages Phase 2+) | 5 | 55 | 17 | 4,091 | 2,523 | 208 |
| **累计** | **10** | **~143** | **~32** | **~9,671** | **~4,023** | **521** |

### 5.2 Wave 2 Verdict

> **Wave 2 完成。5 个包的 Phase 2（hooks 含 Phase 3）全部达到 exit criteria：kernel step loop 可运行（49 tests）、eval 可落 durable trace（42 tests）、storage key/ref builders 可消费（31 tests）、workspace mount/namespace 可操作（52 tests）、hooks dispatcher 可发射（34 tests）。共 208 tests 全部通过。Wave 3 可以立即启动。**

---

## 附录

### A. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v1.0 | 2026-04-16 | Opus 4.6 | Wave 2 完成报告 |
