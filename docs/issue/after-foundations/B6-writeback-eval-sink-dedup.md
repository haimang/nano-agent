# [B6 / writeback] Eval sink must dedup by messageUuid + emit overflow disclosure

> **Issue ID**: `B6-writeback-eval-sink-dedup`
> **Action plan**: `docs/action-plan/after-foundations/B6-nacp-1-2-0-upgrade.md` (待写) + B6-related observability changes
> **Phase**: B6 (NACP 1.2.0 + observability dedup)
> **Status**: open
> **Created**: 2026-04-19
> **Owner**: TBD (B6 implementer)
> **Type**: writeback (forward-traceability evidence)
> **Source finding**: `docs/spikes/spike-binding-pair/04-eval-fanin-app-layer-dedup-required.md` (`spike-binding-pair-F04`)

---

## Summary

Cloudflare service-binding fetch transport **does not provide dedup** —— spike-binding-pair 已实测 3 rounds × 20 records w/ shared dedupSeed → 60 records 全部到达，only 20 unique (40 duplicates). 同时 sink overflow 时**静默 drop**（capacity=50 / attempted=100 / dropped=50, no event emitted）。**对 `packages/eval-observability/src/inspector.ts` 与 `packages/session-do-runtime/src/do/nano-session-do.ts` `defaultEvalRecords` 两处 sink 必须立即加 dedup + overflow disclosure**，否则 worker matrix 阶段跨 worker evidence emit 会造成 audit log 大量重复 + 数据静默丢失。

## Context

- spike worker live: `https://nano-agent-spike-binding-pair-a.haimang.workers.dev`
- spike finding doc: `docs/spikes/spike-binding-pair/04-eval-fanin-app-layer-dedup-required.md`
- Combined run output: `spikes/round-1-bare-metal/spike-binding-pair/.out/2026-04-19T08-28-14Z.json`

## Required action

### 1. Modify `packages/eval-observability/src/inspector.ts:78` (`SessionInspector`)

Add input-side dedup by messageUuid:

```ts
export class SessionInspector {
  private seenMessageUuids = new Set<string>();

  ingest(event: SessionStreamEvent): IngestResult {
    const uuid = (event as { messageUuid?: string }).messageUuid;
    if (uuid && this.seenMessageUuids.has(uuid)) {
      return { dedup: true, ingested: false };
    }
    if (uuid) this.seenMessageUuids.add(uuid);
    // ... existing append logic
  }
}
```

Default behavior: dedup enabled. Provide opt-out config for cases where duplicate-tracking is itself the test target.

### 2. Modify `packages/session-do-runtime/src/do/nano-session-do.ts` (`defaultEvalRecords`)

Same dedup at sink入口. Plus, when `defaultEvalRecords.length >= DEFAULT_SINK_MAX (1024)`:
- **Don't silently drop** the new record
- Emit explicit `eval.sink.overflow_drop` event into a separate ring buffer or stderr log
- Increment a counter accessible via `getDefaultEvalRecords().overflowCount`

### 3. Consider new hook event `EvalSinkOverflow` in B5 catalog expansion

This is a **B5 design input**, not a B6 obligation. Add to candidates list:

| Event candidate | Class | Reason |
|---|---|---|
| `EvalSinkOverflow` | (new class — observability lifecycle) | Triggered when sink hits DEFAULT_SINK_MAX; allows higher-layer code to react (e.g. flush to durable storage) |

If B5 designer agrees to add this event, then the sink change above should `dispatcher.emit("EvalSinkOverflow", { droppedCount, capacity })` instead of (or in addition to) the local counter increment.

### 4. NACP 1.2.0 spec mention (B6)

`docs/rfc/nacp-1-2-0.md` (B6 deliverable) should document:
- "Eval sink dedup is mandatory at receiving worker; transport does not provide dedup"
- "Anchor headers MUST be lowercase" (cross-reference binding-F02)

This is **doc-only** in the spec — no new NACP message kind required.

## Acceptance criteria

- [ ] `SessionInspector.ingest()` dedups by messageUuid (default on, opt-out config)
- [ ] `defaultEvalRecords` sink dedups by messageUuid + emits overflow disclosure
- [ ] Contract test: shared messageUuid emit ×3 → sink size = 1
- [ ] Contract test: sink overflow → `overflowCount` increments and explicit signal observable
- [ ] If B5 adds `EvalSinkOverflow` event, dispatcher integration done
- [ ] NACP 1.2.0 spec mentions dedup contract
- [ ] Round 2 integrated spike re-runs V3-binding-eval-fanin against ship'd packages and confirms `applicationLevelDedupRequired: false` post-ship

## Related findings (potentially co-shipped)

- `spike-binding-pair-F02` (anchor headers lowercase) — touches `cross-seam.ts` and same NACP spec doc
- `spike-binding-pair-F03` (hooks-callback contract) — informational; no co-ship needed

## References

- Charter: `docs/plan-after-foundations.md` §6 Phase 4 + §11.1 Exit Criteria 5/6
- Source finding: [binding-F04](../../spikes/spike-binding-pair/04-eval-fanin-app-layer-dedup-required.md)
- Binding rollup: `docs/spikes/binding-findings.md` §3
- Spike code: `spikes/round-1-bare-metal/spike-binding-pair/worker-a/src/probes/eval-fanin.ts`
- Tracking policy: `docs/issue/README.md`
