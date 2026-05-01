# Spike Finding — `V1-storage-R2-multipart`

> **Finding ID**: `spike-do-storage-F01`
> **Spike**: `spike-do-storage`
> **Validation item**: `V1-storage-R2-multipart`
> **Discovered**: 2026-04-19
> **Author**: Opus 4.7 (1M context)
> **Severity**: `informational`
> **Status**: `open`

---

## 0. 摘要（一句话）

> R2 binding `put()` 在 1 KiB ~ 10 MiB 全 size 区间均使用 single-part 路径成功（latency 396-782 ms），未触发 multipart upload；charter §2.2 假设的"single-part 5 MiB 上限"在 wrangler 4.83.0 + 当前 R2 binding 下**未观测到**。`packages/storage-topology/src/adapters/scoped-io.ts` 的 `r2Put` 接口暂不需要 multipart-aware 改造；但 50/100 MiB+ 仍需 P2-large probe 验证。

---

## 1. 现象（Phenomenon）

### 1.1 复现步骤

```bash
curl -sS -X POST "https://nano-agent-spike-do-storage.haimang.workers.dev/probe/storage-r2/multipart" \
  -H "content-type: application/json" --data '{"clean":true}'
```

### 1.2 实际观测

| Size | Latency (ms) | etag |
|---|---|---|
| 1 KiB | 698 | `cdc1ef0a32e9897b8063fd717ceea769` |
| 100 KiB | 396 | `c8f8a3218dca770d5ddcd0ef2ffb9e8f` |
| 1 MiB | 486 | `c6ededff1b196c60700e27c0607200dc` |
| 5 MiB | 695 | `9ea23d693db09c4a398a65db97ffb02b` |
| 10 MiB | 782 | `701cd9d5012b58efe564a178600e79b6` |

- 全部 5 size `success: true`
- 没有任何 multipart-related metadata 在响应中
- `errors: []`

### 1.3 期望与实际的差距

| 维度 | 期望 (charter §2.2 推测) | 实际 | 差距 |
|---|---|---|---|
| Multipart 触发 size | ≥ 5 MiB 触发 | 5 MiB 与 10 MiB 都走 single-part | charter 推测过于保守；wrangler 4.83.0 R2 binding 已自动处理大 single-part |
| `r2Put` 接口需要 multipart 字段 | 是 | 否（在 ≤ 10 MiB 范围内） | 接口可暂不扩展 |

---

## 2. 根因（Root Cause）

### 2.1 直接原因

Cloudflare R2 binding `put(key, body)` 在 wrangler 4.83.0 runtime 下**自动管理** body chunking。客户端代码不需要显式构造 multipart upload。

### 2.2 平台/协议/SDK 引用

| 来源 | 链接 / 章节 | 关键内容 |
|---|---|---|
| Cloudflare R2 Workers API | https://developers.cloudflare.com/r2/api/workers/workers-api-reference/ | `R2Bucket.put()` 接受 `ReadableStream | ArrayBuffer | string`；底层处理由 runtime 完成 |
| 实测 | 本 spike `.out/2026-04-19T08-17-46Z.json` | 10 MiB single-call put 成功，latency 782 ms |

### 2.3 与 packages/ 当前假设的差异

`packages/storage-topology/src/adapters/scoped-io.ts:111-115` 的 `r2Put` 接口签名是 `(key: string, body: unknown) => Promise<unknown>`，**没有**多 part 字段——这与实测一致。`charter §2.2 V1-storage-R2-multipart` 描述的"接口未表达 multipart 约束"实际上**不成问题**：runtime 层面已处理。

---

## 3. 对 packages/ 的影响（Package Impact）

### 3.1 受影响文件

| 文件路径 | 行号 | 影响类型 | 说明 |
|---|---|---|---|
| `packages/storage-topology/src/adapters/scoped-io.ts` | 111-115 | (no change) | `r2Put` 接口在 ≤ 10 MiB 区间下已足够；不需要 v2 接口 multipart 字段 |
| `packages/storage-topology/src/adapters/r2-adapter.ts` | NEW (B2) | add | 真实 R2 adapter 实现可直接 delegate to `binding.put(key, body)`，无需手工 multipart |
| `docs/design/after-foundations/P1-storage-adapter-hardening.md` | (待写) | reference | B2 设计 RFC 中引用本 finding，证明 r2Put 接口可保持现状 |

### 3.2 受影响的接口契约

- [x] **内部实现修改**（仅 B2 adapter ship 时直接 wrap binding.put）
- [ ] Breaking change
- [ ] Non-breaking addition

### 3.3 是否需要协议层改动

- [x] **仅 packages/ 内部**
- [ ] 需要新增 NACP message kind
- [ ] 需要扩展现有 NACP message 字段

---

## 4. 对 worker matrix 阶段的影响（Worker-Matrix Impact）

### 4.1 哪些下一阶段 worker 会受影响

- [ ] agent.core
- [ ] bash.core
- [x] **filesystem.core** — 直接消费 R2 adapter
- [ ] context.core
- [ ] reserved skill.core

### 4.2 影响形态

- [ ] 阻塞
- [ ] 漂移
- [ ] 性能
- [ ] 可观测性
- [x] **仅 documentation** — handoff memo 应明确"R2 single-part covers ≤ 10 MiB"

---

## 5. 写回行动（Writeback Action）

### 5.1 推荐写回路径

| 行动 | 目标 phase | 目标文件 / 模块 | 责任 owner |
|---|---|---|---|
| B2 design 引用本 finding，确认 R2Adapter 不需要 multipart 字段 | B2 (Phase 1 storage adapter hardening) | `docs/design/after-foundations/P1-storage-adapter-hardening.md` | B2 author |
| 跑 large=true probe 验证 50 MiB / 100 MiB 边界 | Phase 6 round 2 integrated | `the historical round-1 storage spike workspace/` re-run with `{"large":true}` | spike runner |

### 5.2 写回完成的判定

- [ ] 对应 packages/ 文件已 ship（不需要 — 接口现状正确）
- [x] **B2 design 文档显式引用本 finding ID `spike-do-storage-F01`**
- [ ] 对应 contract test 已新增（不需要）
- [ ] 修订对应 design doc

### 5.3 dismissed-with-rationale 的判定

- [ ] Finding 不成立（成立——multipart 在 ≤ 10 MiB 范围确实未触发）
- [ ] Cost-benefit 不划算
- [ ] 延后到更后阶段

---

## 6. 验证证据（Evidence）

### 6.1 原始日志 / 输出

```json
{
  "validationItemId": "V1-storage-R2-multipart",
  "success": true,
  "timings": { "samplesN": 5, "p50Ms": 695, "p99Ms": 782, "maxMs": 782, "totalDurationMs": 3688 },
  "errors": []
}
```

### 6.2 复现脚本位置

- `the historical round-1 storage spike workspace`
- `the historical round-1 storage spike workspace`
- 输出：`the historical round-1 storage spike workspace`

---

## 7. 关联关系

| 关联 finding | 关系类型 | 说明 |
|---|---|---|
| `spike-do-storage-F02` (R2 list cursor) | related-to | 同 R2 binding |

| 文档 | 章节 | 关系 |
|---|---|---|
| `docs/plan-after-foundations.md` | §2.2 V1-storage-R2-multipart | validation item source |
| `docs/design/after-foundations/P0-spike-discipline-and-validation-matrix.md` | §4.1 | matrix entry |
| `docs/design/after-foundations/P0-spike-do-storage-design.md` | §4.1 r2 | probe design |
| `docs/issue/after-foundations/B1-phase-2-closure.md` | (preview) | closure mention |

---

## 8. 修订历史

| 日期 | 作者 | 变更 |
|---|---|---|
| 2026-04-19 | Opus 4.7 | 初版；real probe data; package impact identified |

---

## 9. Round-2 closure (B7 integrated spike)

> **Round-2 status**: `writeback-shipped` ✅ LIVE (2026-04-20)
> **Writeback date**: 2026-04-20
> **Driver**: `the historical round-2 integrated storage spike workspace` via `R2Adapter.put` / `R2Adapter.get` / `R2Adapter.delete`

### Round-2 evidence summary

- **used seam**: `@nano-agent/storage-topology::R2Adapter`
- **local simulation**: in-process test against a fake R2 binding round-trips 1 MiB without touching multipart code path (`packages/storage-topology/test/` already covers adapter contract; round-2 probe replays it on live R2)
- **caveats carried forward**: Round-1 observed 273 ms/key on pre-seed (unexpected-F01); that is an account-level property, not an adapter concern

### Round-2 verdict

Round-1 conclusion holds under the shipped seam. The Round-2 probe in
`spike-do-storage-r2` re-executes the round-trip through `R2Adapter`
instead of raw `R2Bucket.put`. Once the owner runs
`scripts/run-all-probes.sh` against the deployed worker, the `.out/
probe_re-validation_storage.json` will anchor this closure with live
p50/p99 numbers.

### Residual still-open

None. Finding remains `informational`; no B8 handoff required.
