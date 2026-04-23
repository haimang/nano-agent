# Nano-Agent Verification Ladder

> Owner: A6 (post-skeleton phase 5 — deployment dry-run + real boundary verification)
> Status: `frozen v1` (2026-04-18, A6 Phase 1 closure)

This tree implements the L0 / L1 / L2 verification ladder defined in
`docs/action-plan/after-skeleton/A6-deployment-dry-run-and-real-boundary-verification.md`.

## Layout

```text
test-legacy/verification/
├── README.md                        ← this file
├── profiles/                        ← wrangler / binding manifests
│   ├── manifest.ts                  ← typed registry of all profiles
│   ├── local-l0.json                ← node harness (pure isolate)
│   ├── remote-dev-l1.json           ← `wrangler dev --remote`
│   └── deploy-smoke-l2.json         ← `wrangler deploy + workers.dev smoke`
├── smokes/                          ← runner + L1/L2 smoke cases
│   ├── runner.ts                    ← smoke runner + verdict computer
│   ├── inventory.ts                 ← maps existing E2E to L0/L1/L2
│   ├── l1-session-edge.smoke.ts     ← L1 session.start → ack → resume
│   ├── l1-external-seams.smoke.ts   ← L1 fake hook + capability + provider
│   └── l2-real-provider.smoke.ts    ← L2 gpt-4.1-nano golden path
└── verdict-bundles/                 ← per-run output (gitignored except .gitkeep)
```

## Verification ladder (frozen)

| Layer | Mode | Tooling | Purpose | When to run |
|------|------|---------|---------|-------------|
| **L0** | in-process | `vitest` / `node --test` | Contract + scenario smoke against test doubles | every PR |
| **L1** | deploy-shaped dry-run | `wrangler dev --remote` (or simulated `WorkerHarness`) | Worker / DO / service-binding boundary in a fast feedback loop | every milestone, PR-trigger optional |
| **L2** | real-boundary smoke | `wrangler deploy` + `workers.dev` smoke | Real cloud bindings + real provider (`gpt-4.1-nano`) | gate before phase advancement |

### Evidence-grade vocabulary (A6-A7 review GPT R1/R2)

The ladder above describes intent. The actual smoke runs carry one of
three **evidence grades** that a reviewer should read before trusting
a verdict:

| Grade | What the smoke actually exercised |
|-------|-----------------------------------|
| `local-l0-harness` | In-process `WorkerHarness` + fake bindings; no service-binding boundary, no real network. Useful for adapter contract drift, insufficient for L1 claims. |
| `remote-dev-l1` | `baseUrl` set to a live `wrangler dev --remote` URL AND `WorkerHarness.localFallback === false`; the smoke path hits the deployed Worker entry. |
| `deploy-smoke-l2` | `wrangler deploy` target URL + real provider + real cloud bindings; the profile's `smokeAssertionContract` actually holds. |

Current state (2026-04-18, post A4-A5 + A6-A7 review fix):

- `l1-session-edge`: can now actually reach a remote baseUrl when one
  is supplied (harness `fetch()` proxies instead of silently resolving
  locally). Default still runs as `local-l0-harness`.
- `l1-external-seams`: still `local-l0-harness` only — the bundle
  `blocking` list now says so explicitly. Companion
  `wranglers/{fake-hook,fake-capability,fake-provider}` workers are
  needed before this can become real L1 evidence.
- `l2-real-provider`: `runRealSmoke()` now enforces the profile's
  `smokeAssertionContract` (`response.status === 'ok' &&
  response.output.length > 0`); harness-fallback path records the
  contract gap as a blocker. Real-cloud evidence still depends on a
  Worker that routes the golden prompt through the provider.

## Verdict thresholds (frozen)

| Verdict | Definition |
|---------|-----------|
| **green** | All required L0 + L1 smoke cases pass AND at least one L2 smoke case for both `provider-golden-path` and `cloud-binding-spotcheck` passes. |
| **yellow** | The provider golden path passes but a non-blocking surface (e.g. one L1 case in `optional` group) is recorded as `failed`. The blocking-list field of the verdict bundle MUST be populated. |
| **red** | Either the session edge dry-run (P3-01) or the provider golden path (P4-01) fails. |

## Bundle shape

Each run produces an immutable JSON bundle under
`test-legacy/verification/verdict-bundles/<isoTimestamp>-<profile>-<scenario>.json`
with this shape:

```jsonc
{
  "bundleVersion": 1,
  "profile": "remote-dev-l1",
  "scenario": "l1-session-edge",
  "startedAt": "2026-04-18T...",
  "endedAt":   "2026-04-18T...",
  "verdict": "green" | "yellow" | "red",
  "blocking": ["…issues that block phase advancement…"],
  "trace": { "events": [...], "anchorTraceUuid": "..." },
  "timeline": [...],
  "placement": [...],
  "summary": { "passes": N, "failures": N, "skipped": N },
  "failureRecord": [{ "name": "...", "reason": "...", "detail": {...} }],
  "latencyBaseline": { "wsAttachMs": N, "firstByteMs": N, "fullTurnMs": N },
  "notes": "…freeform reviewer notes…"
}
```

This shape is the canonical handoff to **A7 (P6 storage / context evidence
closure)** — A7 consumes the `placement` + `latencyBaseline` + `failureRecord`
fields verbatim.

## Secret injection (Q11)

| Layer | Source of secrets |
|------|-------------------|
| **L1** | `.dev.vars` (gitignored) consumed by `wrangler dev --remote`. |
| **L2** | `wrangler secret put OPENAI_API_KEY` for the deployed Worker. |
| **Forbidden** | committing keys to the repo, `.env` files, or per-machine env vars without a profile note. |

## Local fallback for the runner

`smokes/runner.ts` works against either:

1. a real `wrangler dev --remote` URL passed via `--baseUrl`, or
2. an in-process `WorkerHarness` (default, no `wrangler` required) that
   wires `NanoSessionDO.fetch()` directly so the same smoke specs run on
   any developer laptop. The harness is a faithful in-process double of
   the L1 boundary — it shares `acceptIngress` + `WsController` + the
   same composition profile — but is explicitly NOT L1: the bundle's
   `profile` field records `local-l0-harness` so reviewers cannot
   accidentally interpret it as a deploy-shaped run.
