# `@nano-agent/context-management`

After-Foundations Phase 3 (B4) — context governance runtime for
nano-agent. Three submodules, one public root:

- **`budget/`** — token / compact policy contract (`BufferPolicy` +
  `CompactPolicy` + env override channel).
- **`async-compact/`** — canonical PX lifecycle implementation
  (scheduler, planner, prepare-job, committer, version-history,
  fallback, events). Exposes `AsyncCompactOrchestrator` as the entry
  point and a kernel-shaped `CompactDelegate` adapter.
- **`inspector-facade/`** — context-specific HTTP/WS facade. Wraps
  `SessionInspector` (does NOT rewrite); ships a Claude-Code-shape
  `UsageReport` plus nano-agent multi-worker fields.

## Source-of-truth references

- Charter: `docs/plan-after-foundations.md` §1.3 / §4.1 D / §7.4 / §11.1
- Canonical lifecycle: `docs/design/after-foundations/PX-async-compact-lifecycle-spec.md`
- B1 evidence: spike-do-storage F04 / F06 / F08 + spike-binding-pair
  F01 / F02 / F03 / F04 + unexpected-F02

## Public API by submodule

### `budget/`

```ts
import {
  DEFAULT_COMPACT_POLICY,
  mergeCompactPolicy,
  applyEnvOverride,
  shouldArm,
  shouldHardFallback,
  type BufferPolicy,
  type CompactPolicy,
  type UsageSnapshot,
} from "@nano-agent/context-management";
```

- `DEFAULT_COMPACT_POLICY` is the frozen PX-spec §3.1 defaults.
- `applyEnvOverride(env)` reads `NANO_AGENT_COMPACT_*` keys and
  returns a `CompactPolicyOverride` that the host composes with its
  own per-session override before passing to `mergeCompactPolicy`.

### `async-compact/`

```ts
import {
  AsyncCompactOrchestrator,
  createKernelCompactDelegate,
  noopLifecycleEmitter,
  bridgeToHookDispatcher,
} from "@nano-agent/context-management";

const orchestrator = new AsyncCompactOrchestrator({
  sessionUuid,
  doStorage,    // @nano-agent/storage-topology DOStorageAdapter
  r2,           // optional R2Adapter for F08 promotion
  llmProvider,  // your background summariser
  emitter: bridgeToHookDispatcher(hookDispatcher.emit.bind(hookDispatcher)),
});

await orchestrator.tryArm(usage);
orchestrator.tryPrepare({ layers, contextVersion: 0 });
const outcome = await orchestrator.tryCommit({
  contextVersion: 0,
  atTurnBoundary: true,
  usage,
});
```

The kernel adapter wires the orchestrator into
`@nano-agent/agent-runtime-kernel`'s `CompactDelegate`:

```ts
const compactDelegate = createKernelCompactDelegate({
  orchestrator,
  readContext: async () => ({ layers, contextVersion }),
  reason: "kernel-requested",
});
// pass to KernelDelegates.compact
```

### `inspector-facade/`

```ts
import {
  InspectorFacade,
  mountInspectorFacade,
} from "@nano-agent/context-management";

// Worker entry — default disabled
const response = await mountInspectorFacade({
  env: env as Record<string, string | undefined>,
  request,
  remoteIp,
  facadeFactory: (sessionUuid) =>
    new InspectorFacade({
      sessionUuid,
      auth: {
        bearerToken: env.INSPECTOR_BEARER_TOKEN,
        ipAllowlist: env.INSPECTOR_IP_ALLOWLIST?.split(","),
      },
      providers: { /* … */ },
    }),
});
if (response) return response; // facade handled it
```

Endpoints (per `P3-context-management-inspector.md §4`):

| Method | Path | Purpose |
|---|---|---|
| GET  | `/inspect/sessions/:id/context/usage`         | UsageReport (Claude-Code shape + nano-agent fields) |
| GET  | `/inspect/sessions/:id/context/layers?tag=…`  | LayerView[] (redacted previews) |
| GET  | `/inspect/sessions/:id/context/policy`        | { buffer, compact } |
| GET  | `/inspect/sessions/:id/context/snapshots`     | SnapshotMetadata[] |
| GET  | `/inspect/sessions/:id/context/compact-state` | CompactStateInspectorView |
| POST | `/inspect/sessions/:id/context/snapshot`     | trigger snapshot capture |
| POST | `/inspect/sessions/:id/context/compact`      | { mode: "async" \| "sync" } |
| POST | `/inspect/sessions/:id/context/restore`      | { snapshotId } |

All header constants are **lowercase** (per binding-F02):
`x-inspector-bearer`, `x-inspector-ip-allowlist-bypass`,
`x-nacp-trace-uuid`. The facade surfaces a deduplication caveat
(`duplicate-events-possible-until-b6-dedup`) in
`UsageReport.diagnostics` until B6 ships `SessionInspector` dedup.

## B1 finding contracts honoured

- **F04** — committer always uses `state.storage.transaction()`.
- **F06** — committer NEVER touches D1 BEGIN/COMMIT.
- **F08** — committer size-routes summaries OUTSIDE the transaction
  (`maxValueBytes` pre-check is the orchestrator's responsibility,
  not the tx callback's).
- **binding-F02** — all inspector header constants are lowercase.
- **binding-F04** — facade documents the dedup caveat; B6 will
  install the actual dedup at the `SessionInspector` input.
- **unexpected-F02** — KV writes for advisory state should use
  `KvAdapter.putAsync`; this package does not enforce it (callers
  decide), but the `ReferenceBackend` substrate already does.

## Versioning

`0.1.0` — initial B4 ship.
