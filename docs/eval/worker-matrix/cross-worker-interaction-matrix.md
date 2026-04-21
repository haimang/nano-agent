# Worker Matrix — Cross-Worker Interaction Matrix

> Status: `patch-2 from context-space-examined-by-opus.md §6`
> Author: Claude Opus 4.7 (1M context)
> Date: 2026-04-21
> Purpose: give worker-matrix charter authors a single N×N interaction view so they can derive dependency graphs, first-wave ordering, and deploy-shape wiring without re-reading 4 worker `external-contract-surface.md` files.
>
> This file is **derived** from (and must stay consistent with) the per-worker docs at `docs/eval/worker-matrix/{agent,bash,context,filesystem}-core/`. If a cell here disagrees with its source, the per-worker doc is authoritative and this matrix must be updated.

---

## 0. How to read this

- **Rows** = producer (who initiates the call)
- **Columns** = consumer (who is called)
- **Each cell**: the seam type + the current code status + first-wave necessity
- **Seam type tags**:
  - `tool.call.*` — NACP-Core tool-call envelope family
  - `hook.emit/outcome` — NACP-Core hook event family
  - `context.compact.*` — NACP-Core compact request/response
  - `session.stream.event` — NACP-Session server-push stream channel
  - `initial_context` — `session.start.body.initial_context` wire hook
  - `in-process handle` — subsystem injected via composition factory, no wire
  - `tenant-scoped storage` — DO storage via `getTenantScopedStorage()`
- **Status tags**:
  - `real` — deploy-shaped code path exists + regression-tested
  - `seam` — transport/composition slot exists but no default consumer
  - `missing` — no code, no seam
  - `not-applicable` — interaction is architecturally excluded
- **First-wave necessity**:
  - `P0-required` — must ship before worker-matrix Phase 0 closes
  - `P0-optional` — can ship as early as Phase 0 but not blocking
  - `P1-defer` — scheduled for Phase 1 or later
  - `NA` — no interaction needed

---

## 1. The 4×4 matrix

> Diagonal (`X → X`) is elided because the question "how does agent.core call itself" is meaningless at the worker-matrix level.

| producer ↓ / consumer → | `agent.core` | `bash.core` | `context.core` | `filesystem.core` |
|---|---|---|---|---|
| **`agent.core`** | — | `tool.call.request` via `CAPABILITY_WORKER` serviceBindingTransport → **seam** + **P0-required** (must install kernel→capability wiring) | `context.compact.request` + `initial_context` consumer + in-process compact manager → **partial** (compact manager live; initial_context consumer **missing**) + **P0-required for initial_context** | in-process `WorkspaceNamespace` handle via `composeWorkspaceWithEvidence` → **real** (default DO path auto-mounts) + **P0-required** (stays real, must not regress) |
| **`bash.core`** | `tool.call.response` (delivery_kind=response or error) back to agent host → **seam** (transport exists; response path flows back through `ServiceBindingTarget`) + **P0-required** | — | `session.stream.event` (tool progress) → routed through agent.core host, consumed by `SessionInspector` → **real** (via host stream seam) + **P0-required** | calls `WorkspaceFsLike` + `resolveWorkspacePath` — handlers consume the **same** workspace truth agent.core mounts → **real** + **P0-required** (never diverge) |
| **`context.core`** | `hook.outcome` back into agent loop after compact completes; and compact-triggered kernel signal via `createKernelCompactDelegate` → **real** (delegate seam live in `agent-runtime-kernel`) + **P0-required for live compact loop** | **not-applicable** — context.core does not originate tool calls in v1 | — | reads `WorkspaceSnapshotBuilder.buildFragment()` for snapshot capture → **real** + **P0-required** (stays real) |
| **`filesystem.core`** | emits `snapshot.capture` / `assembly` evidence into eval sink supplied by agent.core → **real** (default DO path installs sink) + **P0-required** (stays real) | **not-applicable** — filesystem.core does not originate tool calls; bash.core is the consumer | emits `assembly` / `artifact` / `snapshot` evidence into the same sink context.core reads → **real** + **P0-required** (stays real) | — |

### 1.1 Summary statistics

- **Live (real) cells**: 8 / 12
- **Seam-only cells**: 2 / 12 (both on the `agent ↔ bash` axis — the kernel→capability wiring loop)
- **Partial cells**: 1 / 12 (`agent → context.core initial_context consumer`)
- **Not-applicable cells**: 2 / 12 (context.core and filesystem.core do not originate outgoing `tool.call.*` in v1)

**Interpretation**: the bottleneck for worker-matrix Phase 0 closure is **not** the 4 workers individually — they are all `real` or close. The bottleneck is the **`agent.core ↔ bash.core` loop** (default composition must install kernel + capability wiring) and the **`agent.core → context.core initial_context`** seam (schema frozen, consumer missing).

---

## 2. Protocol surfaces consumed per interaction

### 2.1 `tool.call.*` family (agent ↔ bash)

- `tool.call.request` — agent.core → bash.core (command kind)
- `tool.call.response` — bash.core → agent.core (response or error kind)
- `tool.call.cancel` — agent.core → bash.core (command kind)
- Role gate: `session` (producer of request/cancel) / `capability` or `skill` (producer of response). See `packages/nacp-core/src/messages/tool.ts:19-30`.
- Matrix: `tool.call.request=command`, `tool.call.response=response|error`, `tool.call.cancel=command`. See `packages/nacp-core/src/type-direction-matrix.ts:20-24`.

### 2.2 `context.compact.*` family (agent ↔ context)

- `context.compact.request` — agent.core/kernel → context.core (via `createKernelCompactDelegate`)
- `context.compact.response` — context.core → agent.core/kernel (response or error kind)
- Role gate: request from `session`; response from `capability` or `skill`. See `packages/nacp-core/src/messages/context.ts`.
- Today: in-process only. **No cross-worker transport** for compact exists in v1 (see `context-core/realized-code-evidence.md:294`).

### 2.3 `session.stream.event` family (agent produces; everyone feeds)

- Only `agent.core`'s host (`NanoSessionDO`) produces `session.stream.event` on the WS wire.
- `bash.core` contributes `tool.call.progress` kind events; they are converted to stream events by the host (see `packages/nacp-session/src/adapters/tool.ts`).
- `context.core` does NOT emit stream events directly; it emits evidence records that the host may optionally surface.
- Matrix: `session.stream.event = event` (only). See `packages/nacp-session/src/type-direction-matrix.ts`.

### 2.4 Evidence vocabulary (filesystem + context → eval sink)

- 4 evidence kinds: `assembly`, `compact`, `artifact`, `snapshot`. See `packages/workspace-context-artifacts/src/evidence-emitters.ts:24-84, 120-175, 222-282`.
- Consumer: `BoundedEvalSink` installed by default host in `NanoSessionDO` (see `packages/session-do-runtime/src/do/nano-session-do.ts:148-174, 256-305`).
- This is the one truly N→1 fan-in (filesystem + context + bash + agent all contribute).

### 2.5 `initial_context` wire hook (upstream → agent → context)

- Schema: `SessionStartInitialContextSchema` in `packages/nacp-session/src/upstream-context.ts`
- Producer: an upstream orchestrator (e.g. Contexter gateway) — **not** in worker-matrix scope
- Consumer: should be `agent.core` (host) at session-start time, which should hand the payload to `context.core`'s assembler
- **Current status**: schema frozen + validated in `session.start` body, but **no consumer in session-do-runtime**. This is the single most important `P0-required` gap.

---

## 3. First-wave ordering derived from this matrix

If you read only the seam / partial / missing cells, the minimum viable Phase 0 wiring order is:

1. **Mount kernel + llm + capability into default composition** (fixes `agent → bash` P0-required cell). This is the `agent.core` Phase 0 milestone.
2. **Wire `initial_context` consumer into `buildIngressContext`'s session-start handling** (fixes `agent → context.core` partial cell). Hand the parsed payload to `context.core`'s assembler as the first `contextLayer` entry.
3. **Lock `bash → context` stream-event path** via progress→`session.stream.event` adapter (already `real`, but must be regression-tested once kernel wiring is live).
4. **Lock evidence fan-in** — filesystem + context emit to `BoundedEvalSink`; confirm no silent drop after live turn loop runs.

**Deliberately NOT on the Phase 0 critical path**:

- Independent `bash.core` Worker deploy shell — transport seam is live; a separate wrangler entry is a later bolt-on
- Independent `context.core` Worker deploy shell — no remote `context.compact.*` transport in v1
- `filesystem.core` remote service-binding — host-local workspace mount is sufficient for first wave
- `wrapAsError()` usage in any interaction — helper is provisional; existing `{status, error?}` shape still governs

---

## 4. Cross-cutting invariants that must hold across ALL cells

These are orthogonal to any single interaction but every cell above depends on them:

1. **Tenant boundary**: every cross-seam call must pass `verifyTenantBoundary()` (now `await`ed per B9-R1 fix). DO storage must route through `getTenantScopedStorage()` (per B9 ship).
2. **Matrix legality**: every envelope emitted on wire must pass `NACP_CORE_TYPE_DIRECTION_MATRIX` (core) or `NACP_SESSION_TYPE_DIRECTION_MATRIX` (session). No `delivery_kind: event` on a `tool.call.request`, ever.
3. **Evidence dedup**: `BoundedEvalSink` dedups on `messageUuid`; emitters that do not carry a message_uuid will drop into the overflow ring.
4. **Stream replay**: `SessionWebSocketHelper` owns replay/ack; workers MUST NOT maintain parallel replay state.
5. **Checkpoint contract**: `persistCheckpoint` refuses to persist when `sessionUuid` is null or `teamUuid` is missing — this is load-bearing symmetry with `validateSessionCheckpoint`.

---

## 5. Uncertainties / next-charter-decisions

These are questions this matrix raises but does not (yet) answer:

1. Who owns the `initial_context → warm_slots` mapping logic? (agent.core as stuffing director, or context.core as assembler?) — see also `context-core/index.md:138` open gap.
2. Should `bash.core` be allowed to emit `audit.record` directly, or only via the host? — current code has handlers for both but no policy statement.
3. Does `context.core` ever need to call `bash.core`? (e.g. for a "read more of file X" mid-compact) — currently `not-applicable`, but a future semantic memory phase may change this.
4. If `filesystem.core` is promoted to a remote worker, does it become a `tool.call.*` producer (like `bash.core`) or does it stay as in-process substrate? — architectural decision, not urgent for Phase 0.

Charter authors should treat these as decisions to make, not facts to inherit.

---

## 6. Maintenance rule

This matrix is derived truth. The per-worker `external-contract-surface.md` files are primary truth. Any discrepancy must be resolved by updating this matrix, not the per-worker docs. This file is re-derivable from:

- `docs/eval/worker-matrix/agent-core/external-contract-surface.md`
- `docs/eval/worker-matrix/bash-core/external-contract-surface.md`
- `docs/eval/worker-matrix/context-core/external-contract-surface.md`
- `docs/eval/worker-matrix/filesystem-core/external-contract-surface.md`

If those 4 files change, this file must be re-reviewed within the same PR.
