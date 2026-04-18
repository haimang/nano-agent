# After-Skeleton Storage Evidence Report — v1

> Owner: A7 (Phase 6 — storage-and-context-evidence-closure)
> Status: `frozen v1` (2026-04-18 closure)
> Upstream inputs:
> - A2 substrate decision (`docs/eval/after-skeleton-trace-substrate-benchmark.md`)
> - A6 verdict bundles (`test/verification/verdict-bundles/`)
> - P6 design (`docs/design/after-skeleton/P6-storage-and-context-evidence-closure.md`)

## 0. Scope

This report consolidates the five A7 evidence streams — `placement`,
`assembly`, `compact`, `artifact`, `snapshot` — into an owner-reviewable
judgement pack. The goal is **not** to finalise capacity, DDL or the
long-term context architecture. The goal is to give A8 / A9 / A10 a
single upstream artefact they can cite instead of re-running synthetic
smoke each time.

## 1. Evidence streams (A7 Phase 1 freeze)

| Stream | Vocabulary file | Runtime owner | Sink wiring point |
|-------|-----------------|----------------|-------------------|
| `placement` | `packages/eval-observability/src/evidence-streams.ts` | `eval-observability::DoStorageTraceSink`, session-do-runtime checkpoint seam | `new DoStorageTraceSink(storage, team, session, { evidenceSink })` |
| `assembly` | same | `workspace-context-artifacts::ContextAssembler` callers | `emitAssemblyEvidence(sink, anchor, { result, consideredKinds })` |
| `compact` | same | `workspace-context-artifacts::CompactBoundaryManager` callers | `emitCompactEvidence(sink, anchor, { phase, ... })` |
| `artifact` | same | `workspace-context-artifacts::PreparedArtifacts + promotion seam` | `emitArtifactEvidence(sink, anchor, { artifactName, stage })` |
| `snapshot` | same | `workspace-context-artifacts::WorkspaceSnapshotBuilder`, `session-do-runtime::checkpoint` | `emitSnapshotEvidence(sink, anchor, { phase, fragment, restoreCoverage? })` |

Emitter ownership (AX-QNA Q14): the **vocabulary and sink** live in
`eval-observability`; the **live emitter** belongs to the package that
owns the business action. Observability never invents business
evidence on its own.

## 2. Calibration verdict contract (AX-QNA Q13)

The four-way verdict vocabulary is exported as
`CALIBRATION_VERDICTS = [provisional, evidence-backed, needs-revisit, contradicted-by-evidence]`.

Thresholds (defaults, override per hypothesis):

- `DEFAULT_EVIDENCE_BACKED_MIN_SIGNALS = 3`
- `DEFAULT_NEEDS_REVISIT_MIN_CONTRADICTORY = 1`
- `DEFAULT_CONTRADICTED_MIN_CONTRADICTORY = 5`

Rules:

- `contradictory ≥ contradictedMin` → `contradicted-by-evidence`
- `contradictory ≥ needsRevisitMin` → `needs-revisit`
- `supporting ≥ evidenceBackedMin` AND `contradictory == 0` → `evidence-backed`
- otherwise → `provisional`

## 3. Default hypothesis catalog (A7 Phase 4)

`DEFAULT_VERDICT_RULES` ships five hypotheses; each is independently
testable and maps to an action-plan decision already on record.

| Id | Hypothesis | Upstream | Revisit hint |
|----|------------|----------|--------------|
| `placement.do.hot-anchor` | DO storage is the correct hot anchor for trace timeline writes | A2 substrate decision, Q5 | Reconsider on failed DO write or sustained latency |
| `placement.do.write-amp` | DO storage write amplification stays bounded per flush (< 1 MB / write) | A2 benchmark F1 | Investigate flush buffer tuning, possible R2 offload |
| `assembly.required-layer-respected` | Required context layers are never dropped by the assembler's budget pass | Workspace assembly invariant | Recheck budget reservation; consider higher `reserveForResponse` |
| `compact.success-rate` | Compact responses succeed for the configured token budget | Workspace compact contract | Inspect compact worker / summarizer health |
| `snapshot.restore-coverage` | Restore covers ≥ 80% of the captured fragment | Session-DO hibernation path | Inspect which fragment sections are missing; budget `restoreCoverage` per workload |

## 4. How to run a calibration pass

```ts
import {
  DoStorageTraceSink,
  EvidenceRecorder,
  aggregateEvidenceVerdict,
} from "@nano-agent/eval-observability";

const recorder = new EvidenceRecorder();
const sink = new DoStorageTraceSink(storage, teamUuid, sessionUuid, {
  evidenceSink: recorder,
});
// ... run a real session, let the sink flush(), feed assembly/compact
// emitters from their owners ...

const result = aggregateEvidenceVerdict(recorder.all());
for (const v of result.verdicts) {
  console.log(v.id, "=", v.verdict, `(${v.supporting} supporting, ${v.contradictory} contradictory)`);
}
```

Reviewers can extend by passing custom `VerdictRule[]` as the second
argument — `DEFAULT_VERDICT_RULES` stays untouched.

## 5. Current state (2026-04-18, A7 closure)

At A7 closure, every hypothesis in the default catalog sits at
`provisional`. This is the **correct** state for the end of Phase 6:
the rules + runtime wiring are in place, but the real-cloud bundle
that would promote them to `evidence-backed` is gated by A6's
`OPENAI_API_KEY + NANO_AGENT_WORKERS_DEV_URL` injection. Reviewers can
produce an `evidence-backed` snapshot simply by:

1. Setting the A6 secrets in `.dev.vars`
2. Running `pnpm exec tsx test/verification/smokes/gate.ts`
3. Feeding the resulting per-scenario placement evidence through
   `aggregateEvidenceVerdict()`

The loop is **closed** even though the network-bound promotion step is
owner-local.

## 6. Open hypotheses (handed off)

- **Placement promotion to R2** — not yet exercised at the runtime
  layer; no records to grade. Plan: A8's first task will be a thin
  runtime mirror that emits `placement` evidence with `backend: "r2"`.
- **Compact quality** — the current hypothesis looks at success rate,
  not semantic quality. A future `compact.quality` hypothesis belongs
  to the next context-architecture phase, not to A7.
- **Prepared-artifact reuse ratio** — we can express a hypothesis but
  we don't yet have emitters at the LLM layer; will slot into the
  `artifact` stream when llm-wrapper wires them.
- **D1 elevation** — remains `deferred-query` per AX-QNA Q5 + Q20.
  Any D1 role change requires an independent benchmark memo before
  editing the action plan.

## 7. Links for downstream phases

- **A8 storage threshold freeze**: consume `placement.do.*` verdicts
  + revisit hints. Do not take action on `provisional`; take action
  on `needs-revisit` or `contradicted-by-evidence`.
- **A9 context architecture**: start from `assembly` + `compact`
  verdicts; the hypothesis catalog is pre-populated so additional
  rules can be added per-feature.
- **A10 minimal bash**: not directly coupled, but snapshot coverage
  evidence is useful when tool execution writes reach the workspace.
