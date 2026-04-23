# smind-contexter learnings — still-valid carry-over

> **Status**: `historical reference summary`
> **Canonical source**: `docs/eval/after-foundations/smind-contexter-learnings.md`
> **Use this file for**: context-system lessons that still matter after W0-W5

---

## 1. What still survives from the Contexter analysis

These ideas remain useful for worker-matrix:

1. **context should be thought of as layered / staged, not as a flat memory bag**
2. **`initial_context` is a real upstream seam and should stay explicit**
3. **first-wave `context.core` should stay thin rather than jumping to a full semantic engine**
4. **reranker / heavier semantic routing should stay deferred from first-wave**

---

## 2. What this reference should not be used for

Do not use Contexter learnings to:

1. force a full RAG engine into worker-matrix r2
2. blur the current boundary between shipped code, RFC-only seam, and future semantic upgrades
3. override the W1/W3/W5 decisions already frozen in pre-worker-matrix

---

## 3. Where its lessons should land now

Use these learnings through current files:

1. `docs/eval/worker-matrix/context-core/index.md`
2. `docs/rfc/remote-compact-delegate.md`
3. `docs/handoff/pre-worker-matrix-to-worker-matrix.md`

The role of this file is now explanatory, not gate-setting.
