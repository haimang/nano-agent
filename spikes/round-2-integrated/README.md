# spikes/round-2-integrated — B7 Integrated Validation

> Expiration: 2026-08-01  (same as Round 1 baseline)
> Owner: sean.z@haimangtech.cn (CF Account 8b611460403095bdb99b6e3448d1f363)
> Governing plan: `docs/action-plan/after-foundations/B7-spike-round-2-integrated.md`
> Discipline source: `docs/design/after-foundations/P0-spike-discipline-and-validation-matrix.md` §3

## Purpose

Round-2 is the **integrated** counterpart to `spikes/round-1-bare-metal/`. Round 1
probed the platform with hand-rolled wire code; Round 2 drives the same workloads
through the **shipped `@nano-agent/*` packages** (B2 storage-topology, B3 capability-runtime,
B4 context-management, B5 hooks, B6 nacp-core/nacp-session dedup). The deliverable
is a verdict bundle that tells B8 / worker-matrix which Round 1 findings were
truly absorbed by shipped code and which remain platform-level open items.

## Structure

- `spike-do-storage-r2/` — storage / workspace / context / fake-bash / KV / R2 / DO / D1 probes
  driven through `@nano-agent/storage-topology`, `@nano-agent/capability-runtime`,
  `@nano-agent/context-management`, `@nano-agent/workspace-context-artifacts`.
- `spike-binding-pair-r2/` — two-worker service-binding pair for
  `binding-F01` callee-abort and `binding-F04` true callback push path.
  The binding-F04 route exercises `@nano-agent/session-do-runtime`'s
  `BoundedEvalSink` on worker-b. `binding-F02`/`binding-F03`
  re-validation measures raw Cloudflare service-binding platform
  behaviour (lowercase headers + hook callback latency) rather than
  importing `@nano-agent/nacp-core` directly — the nacp-core stamping
  pipeline is contract-tested inside the package, and binding-F04 is
  the true integrated path that crosses a Worker boundary.

## Isolation from Round 1

Round 2 uses **separate** wrangler names, DO class names, KV / R2 / D1 resources.
Round 1 workers, outputs, and finding docs remain the historical baseline and
are **never overwritten** by Round 2.

| Facet | Round 1 | Round 2 |
|---|---|---|
| storage worker | `nano-agent-spike-do-storage` | `nano-agent-spike-do-storage-r2` |
| storage DO class | `ProbeDO` | `IntegratedProbeDO` |
| storage KV | `nano-agent-spike-do-storage-kv` | `nano-agent-spike-do-storage-kv-r2` |
| storage R2 bucket | `nano-agent-spike-do-storage-probe` | `nano-agent-spike-do-storage-probe-r2` |
| storage D1 | `nano_agent_spike_do_storage_d1` | `nano_agent_spike_do_storage_d1_r2` |
| binding worker-a | `nano-agent-spike-binding-pair-a` | `nano-agent-spike-binding-pair-a-r2` |
| binding worker-b | `nano-agent-spike-binding-pair-b` | `nano-agent-spike-binding-pair-b-r2` |

## Disciplines (modified from Round 1)

All 7 Round 1 disciplines still apply with **one modification**: Round 2
**is allowed** to `import "@nano-agent/*"` (discipline 7 exception). That
exception is the entire reason Round 2 exists: the integrated run MUST
validate shipped package seams, not bare-metal wire reconstructions.

See `docs/spikes/_DISCIPLINE-CHECK-round-2.md` for the self-check.

## Gates that Round 2 cannot bypass

- **F09-OWNER-URL** — high-volume curl testing requires an owner-supplied
  durable public endpoint that tolerates the configured sample count.
  Without it, the `curl-high-volume` follow-up stays `still-open`.
- **F03-CROSS-COLO** — KV stale-read with real cross-colo delay buckets
  requires an account / profile that can stage 2+ colos. Without it,
  the `kv-cross-colo-stale` follow-up stays `still-open` (same-colo
  run is NOT a substitute).
- **DEPLOY** — the live `wrangler deploy` + `wrangler tail` path
  requires Cloudflare account credentials. The skeletons here are
  `deploy:dry-run`-ready; live capture is the owner's step.

## Local vs. Live split

Probe modules are written so they can run in three modes:

1. **Local simulation** — exercises the shipped-package seam in-process
   (e.g. `BoundedEvalSink` dedup / overflow) without deploy. Used to lock
   contract assertions in this repo's root `test/*.test.mjs` layer.
2. **Deploy dry-run** — `wrangler deploy --dry-run` validates bindings
   and config without live traffic.
3. **Live capture** — full deploy + tail, gated on owner credentials
   and platform gates above.

Each probe module declares which modes it supports via its
`supportedModes` field in `result-shape.ts`.

## What Round 2 does NOT do

- It does **not** modify B2-B6 ship code **during the integrated
  probe phase**. Any bug discovered during probe execution becomes
  an `integrated-F*` finding doc + downstream issue. (Note: the
  B5-B6 review pre-entry round DID modify shipped packages to close
  review findings — that was a separate, pre-B7 activity documented
  in the B7 action-plan §11.)
- It does **not** back-fill Round 1 `.out/` evidence. Round 1 stays frozen.
- It does **not** re-decide B1 `still-open` findings under owner/platform
  gates. Gates stay open until real evidence arrives.
