# B9 plan reviewed by GPT — historical rewrite trigger

> **Status**: `historical review summary`
> **Canonical source**: `docs/code-review/after-foundations/B9-plan-reviewed-by-GPT.md`
> **Why this file still matters**: it explains why B9 had to be narrowed before worker-matrix could inherit it safely

---

## 1. What this review got right

The plan review correctly forced B9 to become narrower and more honest about:

1. **core vs session matrix ownership**
2. **tenant plumbing target points in `session-do-runtime`**
3. **`initial_context` as an explicit upstream wire seam**
4. **error-body / naming scope control**

Without that rewrite, B9 would have mixed responsibility boundaries and overclaimed what the phase could safely ship.

---

## 2. What is already closed now

The review is no longer an active blocker because its central concerns were later absorbed into shipped truth:

1. matrix ownership was split correctly between core and session
2. tenant plumbing was made load-bearing
3. `SessionStartInitialContextSchema` was shipped
4. error-body helper posture was narrowed to **provisional**

So worker-matrix r2 should treat this review as **ancestry explaining the correction**, not as a live todo list.

---

## 3. What r2 authors should still remember from it

1. do not blur core/session ownership again
2. do not overclaim helper readiness when the wire surface is still provisional
3. do not invent fictional runtime seams that current code does not expose
