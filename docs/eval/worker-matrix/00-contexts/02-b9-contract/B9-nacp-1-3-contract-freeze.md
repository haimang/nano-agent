# B9 NACP 1.3 Contract Freeze — current inheritance summary

> **Status**: `upstream contract ancestry`
> **Canonical source**: `docs/issue/after-foundations/B9-final-closure.md`
> **Current effective baseline**: B9 law, later inherited by `@haimang/nacp-core@1.4.0`, `@haimang/nacp-session@1.3.0`, and `@nano-agent/session-do-runtime@0.3.0`

---

## 1. What worker-matrix must treat as inherited contract truth

From B9, worker-matrix should keep these as already-frozen law:

1. **core-side `(message_type × delivery_kind)` legality**
2. **session-side `(message_type × delivery_kind)` legality**
3. **`SessionStartInitialContextSchema` as the upstream `initial_context` wire shape**
4. **tenant boundary verification must be load-bearing on ingress**
5. **DO storage must flow through tenant-scoped wrappers**
6. **`wrapAsError()` is provisional, not a fully-general legal-envelope generator**

---

## 2. What B9 does not mean today

B9 does **not** mean:

1. worker-matrix should reopen contract freeze before doing r2 rewrite
2. `wrapAsError()` can be treated as fully ready for every response verb
3. V1 binding catalog was changed

Those are all closed or explicitly deferred.

---

## 3. What changed after B9

Pre-worker-matrix later added three major facts on top of B9:

1. W0 moved Tier A protocol-adjacent vocabulary into `@haimang/nacp-core@1.4.0`
2. W2 turned GitHub Packages publishing into a real first publish
3. W4 materialized the 4 worker shells and one live preview deploy

So B9 remains a contract ancestor, but it is no longer the newest worker-matrix input layer.
