# Changelog — @nano-agent/context-management

## Unreleased — 2026-04-23 (worker-matrix P5/D09 DEPRECATED)

### Deprecated

- Full runtime ownership absorbed into `workers/context-core/src/{budget,async-compact,inspector-facade}/` as C1 per worker-matrix D03 (P3). Package is now a **coexistence duplicate**. `CompactPolicy` / `DEFAULT_COMPACT_POLICY` / `AsyncCompactOrchestrator` / `createKernelCompactDelegate` / `InspectorFacade` / `mountInspectorFacade` canonically owned by `workers/context-core`.
- **Compact posture unchanged** (charter Q3c): default composition does NOT auto-wire `createKernelCompactDelegate`; opt-in only. Behavior byte-identical.
- README banner added. Coexistence-period bug-fix discipline unchanged (W3 pattern §6).

## 0.1.0 — 2026-04-20

After-Foundations Phase 3 (B4) — initial package ship. First time
nano-agent has a dedicated context-management runtime.

### Added

- **`budget/` submodule**:
  - `BufferPolicy` + `CompactPolicy` + `CompactPolicyOverride` types
    aligned with `workspace-context-artifacts` `ContextAssemblyConfig`.
  - `DEFAULT_COMPACT_POLICY` matching `PX-async-compact-lifecycle-spec.md §3.1`.
  - `mergeCompactPolicy(override)` with validation
    (0 < soft < hard ≤ 1, non-negative numeric fields).
  - `applyEnvOverride(env)` reading the `NANO_AGENT_COMPACT_*` env keys
    with silent-ignore on invalid values + optional warn callback.
  - Threshold predicates (`shouldArm`, `shouldHardFallback`),
    helpers (`effectivePromptBudget`, `usagePct`, `headroomTokens`).

- **`async-compact/` submodule** — canonical PX lifecycle:
  - `AsyncCompactOrchestrator` entry point with `shouldArm`,
    `tryArm`, `tryPrepare`, `tryCommit`, `forceSyncCompact`,
    `restoreVersion` (501 stub for B7+), `getCurrentState`, and
    `listSnapshots`.
  - Internal collaborators: `CompactionScheduler`,
    `CompactionPlanner` (CoW structural-sharing fork),
    `PrepareJob` (timeout-aware background LLM call wrapper),
    `CompactionCommitter` (DO-tx-based atomic swap with
    F08 size pre-check OUTSIDE the tx + F04 throw-rollback +
    best-effort R2 cleanup on tx failure), `VersionHistory`
    (DO-inline / R2-promoted snapshot persistence), `FallbackController`
    (sync compact path).
  - `LifecycleEvent` channel with `noopLifecycleEmitter`,
    `createCollectingEmitter()`, and `bridgeToHookDispatcher()` —
    keeps B4 unblocked by B5 hooks-catalog expansion (the bridge
    accepts a structurally-typed dispatcher emit fn rather than
    importing `@nano-agent/hooks`).
  - `createKernelCompactDelegate` adapter so the
    `@nano-agent/agent-runtime-kernel` `CompactDelegate` seam can
    invoke `forceSyncCompact` without learning storage details.

- **`inspector-facade/` submodule** — context-specific HTTP/WS:
  - `InspectorFacade` `handle(request)` returning a Fetch `Response`
    (no HTTP framework dep).
  - 5 GET endpoints (`usage` / `layers` / `policy` / `snapshots` /
    `compact-state`) + 3 POST control endpoints (`snapshot` /
    `compact` / `restore`) per `P3-context-management-inspector.md §4`.
  - Lowercase header constants (`x-inspector-bearer`,
    `x-inspector-ip-allowlist-bypass`, `x-nacp-trace-uuid`) per
    binding-F02.
  - `buildUsageReport` Claude-Code-shape with nano-agent multi-worker
    fields (`pendingCompactJobs`, `bufferPolicy`, `versionedSnapshots`,
    `tierRouterMetrics`, `diagnostics`).
  - `redactSecrets` / `redactPayload` (Anthropic / OpenAI / GitHub /
    AWS keys, JWT, bearer headers; recursive on JSON shapes;
    `safeKeys` allow-list for benign field names).
  - `parseBearer` + IPv4 CIDR `isIpAllowed` + combined `checkAuth`.
  - `subscribeStream(filter)` — transport-agnostic subscription
    handle the worker entry adapts to actual WebSocket transport;
    supports tag list + event-name wildcard pattern (`ContextCompact*`).
  - `mountInspectorFacade(options)` — conditional mount helper;
    default disabled (`INSPECTOR_FACADE_ENABLED=1` to enable).
  - `INSPECTOR_DEDUP_CAVEAT = "duplicate-events-possible-until-b6-dedup"`
    surfaced in every `UsageReport.diagnostics` until B6 ships dedup;
    callers can flip `preB6Dedup: false` after the writeback closes.

### Tests

79 cases across 8 test files:

- `test/budget/policy.test.ts` (18 cases)
- `test/async-compact/scheduler.test.ts` (9 cases)
- `test/async-compact/planner.test.ts` (6 cases)
- `test/async-compact/prepare-job.test.ts` (5 cases)
- `test/async-compact/committer.test.ts` (5 cases — F04 / F06 /
  F08 contracts + tx-rollback R2 cleanup)
- `test/async-compact/orchestrator.test.ts` (7 cases — full lifecycle
  + hard fallback + failed path)
- `test/inspector-facade/facade.test.ts` (27 cases — auth, redact,
  routes, subscribe, mount helper)
- `test/integration/kernel-adapter.test.ts` (2 cases — kernel ↔
  orchestrator end-to-end via `createKernelCompactDelegate`)

### Notes / scope boundaries (per Phase 1 freeze)

- **No `storage/` submodule**. The hybrid tier router stays out of
  this package per charter r2; the committer consumes
  `DOStorageAdapter` + `R2Adapter` directly and does its own size
  preflight (per the GPT-reviewed B2 caveat that
  `DOStorageAdapter.transaction()` does NOT auto-apply
  `maxValueBytes` inside the tx callback).
- **No `HookDispatcher` import**. The 5 PX-spec lifecycle event
  names are not yet in the `@nano-agent/hooks` catalog (B5 will
  add them); we ship a parallel `LifecycleEventEmitter` channel +
  a structural `bridgeToHookDispatcher` adapter so B5 can wire the
  real dispatcher with zero B4 code change.
- **No `SessionInspector` rewrite**. The facade wraps the existing
  `eval-observability` primitive via `InspectorDataProviders` so the
  worker entry can plug in either the real inspector or a fake.
- **No production-grade RBAC / OAuth / dashboard**. Auth is
  bearer + IPv4 CIDR (IPv6 is intentionally upstream-proxy gated
  until worker matrix).
- **`restoreVersion` is a 501 honest stub**. The seam exists;
  the actual cross-version restore primitive ships in B7+ alongside
  validation.
