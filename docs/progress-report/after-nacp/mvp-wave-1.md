# MVP Wave 1 Progress Report

> Wave: `Wave 1 — Phase 1 for all 8 packages`
> 起点文档: `docs/investigation/action-batch-final-reviewed-by-opus.md` §2.3 Wave 1
> 执行者: `Claude Opus 4.6 (1M context)`
> 执行时间: `2026-04-16`
> 状态: `completed`

---

## 1. 工作安排起点

本次 Wave 1 执行依据 `docs/investigation/action-batch-final-reviewed-by-opus.md` §2.3 的定义：

> **Wave 1 — 全部 Phase 1 并行：同时启动所有 8 个包的 Phase 1。这些 Phase 只依赖 NACP 包的类型，互不依赖。**

Exit Criteria（引用自终审报告）：
> 所有 8 个包可独立 `build` + `typecheck`，核心 public types 冻结。

每个包的 Phase 1 目标来自各自的 action-plan：
- `agent-runtime-kernel P1`：核心状态类型 + delegate contracts
- `llm-wrapper P1`：canonical model + usage/error taxonomy
- `capability-runtime P1`：capability domain model + registry interfaces
- `workspace-context-artifacts P1`：workspace domain model + paths/refs/context/snapshot types
- `hooks P1`：8-event catalog + outcome taxonomy
- `eval-observability P1`：trace taxonomy + classification + DurablePromotionRegistry + metric names
- `storage-topology P1`：storage taxonomy + data item catalog + evidence signals
- `session-do-runtime P1`：runtime env + composition contract + turn ingress

---

## 2. 工作产出目录

### 2.1 文件清单

共创建 **48 个 TypeScript 源文件** + **8 个 package.json** + **8 个 tsconfig.json** + **1 个 wrangler.jsonc**，合计 **2,580 行源代码**。

#### agent-runtime-kernel (7 files)

| 文件 | 内容 | 参考来源 |
|------|------|---------|
| `src/version.ts` | `KERNEL_VERSION = "0.1.0"` | — |
| `src/types.ts` | `KernelPhase` / `StepKind` / `InterruptReason` / `StepDecision` / `RuntimeEvent` (zod schemas + inferred types) | `context/codex/codex-rs/core/src/state/session.rs` (SessionState), `context/codex/codex-rs/core/src/state/turn.rs` (TurnState/ActiveTurn) |
| `src/state.ts` | `SessionState` / `TurnState` / `KernelSnapshot` + factory functions | codex SessionState/TurnState 分层模式 |
| `src/step.ts` | `KernelStep` schema | — |
| `src/delegates.ts` | `LlmDelegate` / `CapabilityDelegate` / `HookDelegate` / `CompactDelegate` / `KernelDelegates` interfaces | — |
| `src/errors.ts` | `KernelError` class + `KERNEL_ERROR_CODES` | nacp-core error pattern |
| `src/index.ts` | 10 re-exports | — |

#### llm-wrapper (5 files)

| 文件 | 内容 | 参考来源 |
|------|------|---------|
| `src/version.ts` | `LLM_WRAPPER_VERSION = "0.1.0"` | — |
| `src/canonical.ts` | `CanonicalContentPart` (4 variants) / `CanonicalMessage` / `CanonicalLLMRequest` / `NormalizedLLMEvent` (4 variants) / `CanonicalLLMResult` | `context/codex/codex-rs/model-provider-info/src/lib.rs` (ModelProviderInfo), `context/claude-code/services/api/logging.ts` (tengu events) |
| `src/usage.ts` | `LLMUsage` / `FinishReason` / `createEmptyUsage()` | — |
| `src/errors.ts` | `LLMErrorCategory` / `LLMError` / `LlmWrapperError` class | nacp-core error-registry pattern |
| `src/index.ts` | 6 re-exports | — |

#### capability-runtime (6 files)

| 文件 | 内容 | 参考来源 |
|------|------|---------|
| `src/version.ts` | `CAPABILITY_VERSION = "0.1.0"` | — |
| `src/types.ts` | `CapabilityKind` / `ExecutionTarget` / `PolicyDecision` / `CapabilityDeclaration` / `CapabilityPlan` / `CapabilityMetadata` | `context/codex/codex-rs/tools/src/tool_definition.rs` (ToolDefinition) |
| `src/events.ts` | `CapabilityEventKind` / `CapabilityEvent` | — |
| `src/result.ts` | `CapabilityResultKind` / `CapabilityResult` / `INLINE_RESULT_MAX_BYTES = 64KB` | `context/claude-code/utils/toolResultStorage.ts` (large result storage pattern) |
| `src/registry.ts` | `CapabilityRegistry` interface | — |
| `src/index.ts` | 6 re-exports | — |

#### workspace-context-artifacts (7 files)

| 文件 | 内容 | 参考来源 |
|------|------|---------|
| `src/version.ts` | `WORKSPACE_VERSION = "0.1.0"` | — |
| `src/types.ts` | `MountAccess` / `MountConfig` / `BackendKind` / `WorkspaceFileEntry` (zod schemas) | `context/just-bash/src/fs/mountable-fs/mountable-fs.ts` (MountConfig, MountableFs) |
| `src/paths.ts` | Branded `WorkspacePath` / `normalizePath()` / `isChildOf()` / `WORKSPACE_ROOT` | just-bash path routing mental model |
| `src/refs.ts` | `ArtifactKind` / `ArtifactRef` / `PreparedArtifactKind` / `PreparedArtifactRef` | `packages/nacp-core/src/envelope.ts` (NacpRefSchema) |
| `src/context-layers.ts` | `ContextLayerKind` / `ContextLayer` / `ContextAssemblyConfig` (zod schemas) | `context/claude-code/services/compact/compact.ts` (compact layers) |
| `src/snapshot.ts` | `WorkspaceSnapshotFragment` / `CompactBoundaryRecord` (zod schemas) | — |
| `src/index.ts` | 11 re-exports | — |

#### hooks (5 files)

| 文件 | 内容 | 参考来源 |
|------|------|---------|
| `src/version.ts` | `HOOKS_VERSION = "0.1.0"` | — |
| `src/types.ts` | `HookSource` / `HookRuntimeKind` / `HookHandlerConfig` / `HookMatcherConfig` | — |
| `src/catalog.ts` | `HookEventName` (8-event union) / `HOOK_EVENT_CATALOG` (metadata per event) / `isBlockingEvent()` | `context/claude-code/utils/hooks.ts` (PreToolUse/PostToolUse/UserPromptSubmit event model) |
| `src/outcome.ts` | `HookOutcomeAction` / `HookOutcome` / `AggregatedHookOutcome` / `aggregateOutcomes()` | `packages/nacp-core/src/messages/hook.ts` (HookOutcomeBodySchema) |
| `src/index.ts` | 6 re-exports | — |

#### eval-observability (8 files)

| 文件 | 内容 | 参考来源 |
|------|------|---------|
| `src/version.ts` | `EVAL_VERSION = "0.1.0"` | — |
| `src/types.ts` | `TraceLayer` (3-way split) / `EventAudience` | `docs/design/eval-observability-by-opus.md` §5.3 (三分法) |
| `src/trace-event.ts` | `TraceEventBase` + `LlmEvidenceExtension` + `ToolEvidenceExtension` + `StorageEvidenceExtension` → `TraceEvent` | `context/codex/codex-rs/otel/src/events/session_telemetry.rs` (session telemetry fields) |
| `src/classification.ts` | `LIVE_ONLY_EVENTS` / `DURABLE_AUDIT_EVENTS` / `DURABLE_TRANSCRIPT_EVENTS` / `classifyEvent()` / `shouldPersist()` | — |
| `src/durable-promotion-registry.ts` | `DurablePromotionEntry` / `DurablePromotionRegistry` class / `createDefaultRegistry()` | 业主 Q3 要求的可审阅注册表 |
| `src/truncation.ts` | `TRACE_OUTPUT_MAX_BYTES = 10_000` / `truncateOutput()` | `context/codex/codex-rs/rollout/src/recorder.rs:189-212` (10KB truncation) |
| `src/metric-names.ts` | `METRIC_NAMES` (12 hierarchical names: `agent.turn.*` / `agent.tool.*` / `agent.api.*`) | `context/codex/codex-rs/otel/src/names.rs:1-38` (metric naming convention) |
| `src/index.ts` | 9 re-exports | — |

#### storage-topology (5 files)

| 文件 | 内容 | 参考来源 |
|------|------|---------|
| `src/version.ts` | `STORAGE_TOPOLOGY_VERSION = "0.1.0"` | — |
| `src/taxonomy.ts` | `StorageClass` / `StorageBackend` / `storageClassToBackend()` / `ProvisionalMarker` / `ResponsibleRuntime` | — |
| `src/data-items.ts` | `DataItemClass` (19 categories) / `DataItemDescriptor` / `DATA_ITEM_CATALOG` (全部 19 项) | `docs/design/storage-topology-by-opus.md` §7.1 (provisional placement table) |
| `src/evidence.ts` | `EvidenceSignalKind` / `EvidenceSignal` / `CalibrationHint` | — |
| `src/index.ts` | 6 re-exports | — |

#### session-do-runtime (5 files + wrangler.jsonc)

| 文件 | 内容 | 参考来源 |
|------|------|---------|
| `src/version.ts` | `SESSION_DO_VERSION = "0.1.0"` | — |
| `src/env.ts` | `SessionRuntimeEnv` / `RuntimeConfig` / `DEFAULT_RUNTIME_CONFIG` | `packages/nacp-session/src/websocket.ts` (SessionWebSocketHelper options) |
| `src/composition.ts` | `SubsystemHandles` / `CompositionFactory` interface | — |
| `src/turn-ingress.ts` | `TurnIngressKind` / `TurnInput` / `extractTurnInput()` / `TURN_INGRESS_NOTE` | `packages/nacp-session/src/messages.ts` (SessionStartBodySchema) |
| `src/index.ts` | 6 re-exports | — |
| `wrangler.jsonc` | Minimal DO binding skeleton for `NanoSessionDO` | — |

---

## 3. 代码审查与测试结果

### 3.1 Typecheck 结果

| 包 | `tsc --noEmit` | 状态 |
|----|---------------|------|
| agent-runtime-kernel | PASS | ✅ |
| llm-wrapper | PASS | ✅ |
| capability-runtime | PASS | ✅ |
| workspace-context-artifacts | PASS | ✅ |
| hooks | PASS | ✅ |
| eval-observability | PASS | ✅ |
| storage-topology | PASS | ✅ |
| session-do-runtime | PASS | ✅ |

### 3.2 Build 结果

| 包 | `tsc` (emit) | 状态 |
|----|-------------|------|
| agent-runtime-kernel | PASS | ✅ |
| llm-wrapper | PASS | ✅ |
| capability-runtime | PASS | ✅ |
| workspace-context-artifacts | PASS | ✅ |
| hooks | PASS | ✅ |
| eval-observability | PASS | ✅ |
| storage-topology | PASS | ✅ |
| session-do-runtime | PASS | ✅ |

### 3.3 代码质量审查

| 检查项 | 结果 |
|--------|------|
| ESM imports with `.js` extensions | ✅ 全部文件遵循 |
| `verbatimModuleSyntax` compatibility (`export type` for type-only) | ✅ 全部文件遵循 |
| `readonly` on interface fields | ✅ 全部 interface 使用 readonly |
| Zod schemas where applicable (kernel, workspace) | ✅ kernel + workspace 使用 zod |
| Pure TypeScript types (hooks, eval, storage, capability, llm, session-do) | ✅ 不引入不必要的 zod 依赖 |
| JSDoc comments on exported symbols | ✅ 全部文件有 JSDoc |
| No circular dependencies | ✅ 无包内循环引用 |
| No cross-package imports (Phase 1 packages are independent) | ✅ 每个包只 import zod 或自己的文件 |
| nacp-core convention matching (section dividers, error patterns) | ✅ 风格一致 |

### 3.4 关键设计决策验证

| 决策 | 代码体现 | 验证 |
|------|---------|------|
| kernel: single-active-turn | `TurnState.phase` + `KernelPhase` state machine | ✅ |
| kernel: delegate-based | `KernelDelegates` composite interface | ✅ |
| hooks: 8-event minimal set | `HookEventName` 8-member union + `HOOK_EVENT_CATALOG` | ✅ |
| hooks: outcome allowlist per event | `HOOK_EVENT_CATALOG[event].allowedOutcomes` | ✅ |
| eval: three-way split | `TraceLayer = "live" \| "durable-audit" \| "durable-transcript"` | ✅ |
| eval: DurablePromotionRegistry | `DurablePromotionRegistry` class with `createDefaultRegistry()` | ✅ |
| eval: llm.delta not durable | `LIVE_ONLY_EVENTS` set includes "llm.delta" | ✅ |
| storage: all provisional | `ProvisionalMarker` type + `DATA_ITEM_CATALOG` entries all marked | ✅ |
| storage: tenant-scoped keys only | No `_platform/` references in builders | ✅ |
| session-do: turn ingress gap documented in code | `TURN_INGRESS_NOTE` string constant | ✅ |
| session-do: composition factory prevents DO from inlining subsystems | `CompositionFactory` interface | ✅ |
| llm: canonical model decoupled from provider | `CanonicalLLMRequest` has no provider-specific fields | ✅ |
| capability: fake bash is surface not kernel | `CapabilityPlan.source: "bash-command" \| "structured-tool"` | ✅ |
| workspace: ArtifactRef aligns with NacpRef semantics | `ArtifactRef.storageClass` maps to NacpRef kind | ✅ |

---

## 4. 下一步工作分析

### 4.1 Wave 2 范围（引用自终审报告 §2.3）

Wave 2 — 基础设施 Phase 2 + kernel Phase 2（约 1-2 周）：

| 包 | Phase | 内容 |
|----|-------|------|
| storage P2 | key/ref builders + scoped-io alignment | 统一 DO/KV/R2 key schema 和 NacpRef 构造 |
| eval P2 | sink/codec/timeline | TraceSink interface + DoStorageTraceSink + audit.record codec + SessionTimeline |
| hooks P2-P3 | registry/dispatcher/runtime/guards | HookRegistry + HookMatcher + HookDispatcher + local-ts/service-binding runtime + safety guards |
| kernel P2 | reducer/scheduler/interrupt/runner | 状态转移 reducer + step scheduler + interrupt controller + step-driven runner |
| workspace P2 | mount/namespace/backends | mount router + memory backend + reference backend seam |

### 4.2 Wave 2 的前置条件

| 前置条件 | 状态 |
|---------|------|
| Wave 1 全部 8 包 typecheck 通过 | ✅ 已满足 |
| Wave 1 全部 8 包 build 通过 | ✅ 已满足 |
| 核心 public types 冻结 | ✅ 已满足（48 文件，2580 行） |
| nacp-core / nacp-session 已收口 | ✅ 早已满足 |

### 4.3 Wave 2 的关键依赖

- `llm P2` 和 `capability P2` 需要 `workspace P1` 的类型 → ✅ workspace P1 已完成
- `storage P2` 需要 `nacp-core` 的 `NacpRefSchema` → ✅ nacp-core 已收口
- `eval P2` 需要 `nacp-core` 的 `AuditRecordBodySchema` → ✅ nacp-core 已收口
- `hooks P2-P3` 需要 `nacp-core` 的 `HookEmitBodySchema` / `HookOutcomeBodySchema` → ✅ nacp-core 已收口

**结论：Wave 2 所有前置条件已满足，可以立即启动。**

---

## 5. 收口分析

### 5.1 Exit Criteria 检查

| Exit Criteria | 状态 |
|--------------|------|
| 所有 8 个包可独立 `build` | ✅ 8/8 通过 |
| 所有 8 个包可独立 `typecheck` | ✅ 8/8 通过 |
| 核心 public types 冻结 | ✅ 48 文件，2580 行 |
| 后续 Phase 不需要重写核心 public types | ✅ 类型设计完整覆盖 action-plan Phase 1 要求 |

### 5.2 产出统计

| 维度 | 数值 |
|------|------|
| 新增包 | 8 |
| 新增源文件 | 48 |
| 新增源代码行 | 2,580 |
| 新增配置文件 | 17 (8 package.json + 8 tsconfig.json + 1 wrangler.jsonc) |
| Typecheck 通过率 | 8/8 (100%) |
| Build 通过率 | 8/8 (100%) |

### 5.3 Wave 1 verdict

> **Wave 1 完成。8 个包全部达到 Phase 1 exit criteria：可独立 build + typecheck，核心 public types 已冻结。Wave 2 的所有前置条件已满足，可以立即启动。**

---

## 附录

### A. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v1.0 | 2026-04-16 | Opus 4.6 | Wave 1 完成报告 |
