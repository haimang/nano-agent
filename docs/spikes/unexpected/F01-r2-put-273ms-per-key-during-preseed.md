# Spike Finding — `unexpected: R2 put ~270ms per key during preseed`

> **Finding ID**: `unexpected-F01`
> **Spike**: `spike-do-storage` (observed during V1-storage-R2-list-cursor preseed)
> **Validation item**: (not in matrix; opportunistic observation)
> **Discovered**: 2026-04-19
> **Author**: Opus 4.7 (1M context)
> **Severity**: `medium` _(performance signal; affects bulk-write design)_
> **Status**: `open`

---

## 0. 摘要（一句话）

> R2 binding `put(key, body)` for tiny payloads (~10 byte string) shows **~273 ms / call** average during preseed of 50 keys (13.67 s total wall)—much higher than the ~400-700 ms per multi-MB single put observed in `V1-storage-R2-multipart`. This suggests R2 `put` has **per-call fixed cost dominating small writes**, not bandwidth-dominated. **For bulk-write patterns (e.g. `WorkspaceSnapshotBuilder` writing many small artifacts), packages/ must batch or accept the per-key latency tax.**

---

## 1. 现象（Phenomenon）

### 1.1 复现步骤

```bash
# Reproduces during preseed phase of V1-storage-R2-list-cursor probe:
curl -sS -X POST "https://nano-agent-spike-do-storage.haimang.workers.dev/probe/storage-r2/list-cursor" \
  -H "content-type: application/json" --data '{"keyCount":50,"pageLimit":20,"preseed":true}'
```

### 1.2 实际观测

```json
{ "label": "preseed_complete", "value": { "keyCount": 50, "durationMs": 13670 } }
```
50 keys × tiny payload → 13670 ms total → **~273 ms / put**.

Contrast with V1-storage-R2-multipart (single put):

| Size | Latency (ms) |
|---|---|
| 1 KiB | 698 |
| 100 KiB | 396 |
| 1 MiB | 486 |
| 5 MiB | 695 |
| 10 MiB | 782 |

The single-MB puts are ~500-800 ms, while the *small* puts during preseed averaged 273 ms—**not faster than larger puts on a per-call basis** despite 1000x less data.

### 1.3 期望与实际的差距

Expected: small puts to be much faster than MB-sized puts (bandwidth-bound model).
Actual: per-call overhead (network round-trip + R2 API processing) dominates regardless of payload size below some threshold.

---

## 2. 根因（Root Cause）

### 2.1 直接原因

R2 `put` API has fixed network + auth + commit overhead per call. For payloads < ~100 KiB, this overhead is the dominant cost. For 50-key sequential preseed, latency adds linearly: `~50 × ~270 ms ≈ 13.5 s`.

### 2.2 平台/协议/SDK 引用

| 来源 | 章节 | 关键内容 |
|---|---|---|
| Cloudflare R2 docs | (general guidance) | "Use multi-object operations or parallel writes for bulk loads" |
| Probe code | `r2-list-cursor.ts:23-35` | sequential `for` loop over `r2.put(key, payload)` |

### 2.3 与 packages/ 当前假设的差异

`packages/workspace-context-artifacts/src/snapshot.ts` `WorkspaceSnapshotBuilder` may, depending on snapshot size, end up calling `r2.put` many times sequentially. If a typical snapshot has 20+ small artifacts, snapshot wall time will be 5+ seconds—**affects checkpoint latency budget**.

---

## 3. 对 packages/ 的影响（Package Impact）

### 3.1 受影响文件

| 文件路径 | 行号 | 影响类型 | 说明 |
|---|---|---|---|
| `packages/workspace-context-artifacts/src/snapshot.ts` | (existing) | review | 如果 snapshot 含 N 小 artifact，N×270 ms 是 checkpoint latency budget 输入 |
| `packages/storage-topology/src/adapters/r2-adapter.ts` | NEW (B2) | add | 推荐 expose `putParallel(items)` helper 用 `Promise.all` 并发 (验证 R2 是否承受 50 并发) |
| `docs/design/after-foundations/P1-storage-adapter-hardening.md` | (待写) | reference | B2 design 中讨论 bulk-write strategy |

### 3.2 受影响的接口契约

- [x] **Non-breaking addition** (新增 `putParallel` helper 而非改 `put`)
- [ ] Breaking change
- [ ] 内部实现修改

### 3.3 是否需要协议层改动

- [x] **仅 packages/ 内部**
- [ ] 需要新增 NACP message kind
- [ ] 需要扩展现有 NACP message 字段

---

## 4. 对 worker matrix 阶段的影响（Worker-Matrix Impact）

### 4.1 哪些下一阶段 worker 会受影响

- [ ] agent.core
- [ ] bash.core
- [x] **filesystem.core** —— bulk file ingest 必须并发 / batch
- [x] **context.core** —— snapshot bulk-write 必须并发；async-compact summary write 也是单 put，不影响

### 4.2 影响形态

- [ ] 阻塞
- [ ] 漂移
- [x] **性能** —— direct effect on checkpoint / snapshot latency
- [ ] 可观测性

---

## 5. 写回行动（Writeback Action）

### 5.1 推荐写回路径

| 行动 | 目标 phase | 目标文件 / 模块 | 责任 owner |
|---|---|---|---|
| 在 R2Adapter 中 expose `putParallel(items)` helper | B2 | `packages/storage-topology/src/adapters/r2-adapter.ts` | B2 implementer |
| Round 2 spike 验证 R2 在 50 / 100 / 200 并发 put 下的行为（是否触发 rate-limit） | B7 | spike re-run | spike runner |
| `WorkspaceSnapshotBuilder` 检查是否 sequential→parallel 切换 | B2 review | `packages/workspace-context-artifacts/src/snapshot.ts` | B2 implementer |

### 5.2 写回完成的判定

- [ ] 对应 packages/ 文件已 ship
- [ ] 对应 contract test 已新增（latency budget 不超 X ms）

### 5.3 dismissed-with-rationale 的判定

- [ ] Finding 不成立
- [ ] Cost-benefit 不划算
- [ ] 延后到更后阶段

---

## 6. 验证证据（Evidence）

### 6.1 原始日志 / 输出

```
preseed 50 keys × ~10 byte payload = 13670 ms total
average per put ≈ 273 ms
contrast: single 10 MiB put = 782 ms
```

### 6.2 复现脚本位置

- `spikes/round-1-bare-metal/spike-do-storage/src/probes/r2-list-cursor.ts:23-35`

---

## 7. 关联关系

| 关联 finding | 关系类型 | 说明 |
|---|---|---|
| `spike-do-storage-F02` (R2 list cursor) | causes | preseed 是 F02 的副作用 |
| `spike-do-storage-F01` (R2 multipart) | related-to | 同 R2 binding，不同 size 维度 |

| 文档 | 章节 | 关系 |
|---|---|---|
| `docs/design/after-foundations/P0-spike-discipline-and-validation-matrix.md` | §4.5 | optional unexpected category |

---

## 8. 修订历史

| 日期 | 作者 | 变更 |
|---|---|---|
| 2026-04-19 | Opus 4.7 | 初版；opportunistic observation during F02 preseed |

---

## 9. Round-2 closure (B7 integrated spike) — LIVE EVIDENCE

> **Round-2 status**: `writeback-shipped` ✅
> **Writeback date**: 2026-04-20
> **Deploy**: `nano-agent-spike-do-storage-r2.haimang.workers.dev`
> **Raw evidence**: `spikes/round-2-integrated/spike-do-storage-r2/.out/probe_follow-ups_r2-concurrent-put.json`

### Round-2 concurrency curve (LIVE, 1 KiB payload per key, 2026-04-20 final run)

| concurrency | p50 ms | p99 ms | max ms | errors |
|---|---|---|---|---|
| 10 | 336 | 530 | 530 | 0 |
| 50 | 1,310 | 2,396 | 2,396 | 0 |
| 100 | 2,216 | 4,371 | 4,371 | 0 |
| 200 | 4,383 | 8,491 | 8,512 | 0 |

### Round-2 interpretation

- **Zero errors at all levels** up to 200 parallel `put()` — no 429,
  no 5xx, no timeouts. R2 puts scale horizontally without platform
  pushback on this account.
- **p50 scales roughly linearly with concurrency**: ~34 ms @ 10 /
  ~26 ms @ 50 / ~22 ms @ 100 / ~22 ms @ 200 per put. R2 is
  effectively amortizing per-call overhead.
- **p99 tail widens fast past 100**: 4.4 s @ 100 → 8.5 s @ 200
  (latency cliff doubles). 200 is at the edge of the safe envelope.

### B2 calibration recommendation for `R2Adapter.putParallel()`

| tier | concurrency | use case |
|---|---|---|
| **safe-default** | **50** | p99 under 2.5 s; zero errors |
| opportunistic | 100 | p99 ≈ 4.4 s; still clean |
| edge-of-safe | 200 | p99 ≈ 8.5 s; not recommended as a default |

### Round-2 verdict

Finding upgraded from `open` to `resolved-with-calibration`.
B2 `R2Adapter.putParallel()` safe default = **50**. B8 worker-matrix
should treat 100 as the "I know what I'm doing" tier and 200 as a
one-off/drain operation only.

### Residual still-open

- **p99 cliff characterization**: we know 100→200 doubles the p99;
  we don't have a datapoint at 150 to pinpoint the knee. Not
  blocking — 50 as the safe default is well below either.
- **Account-scoped** caveat still applies: number is for this CF
  account at this time; B8 should re-baseline if moving to a
  different account.
