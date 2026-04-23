# Spike Finding — `V1-storage-KV-stale-read`

> **Finding ID**: `spike-do-storage-F03`
> **Spike**: `spike-do-storage`
> **Validation item**: `V1-storage-KV-stale-read`
> **Discovered**: 2026-04-19
> **Author**: Opus 4.7 (1M context)
> **Severity**: `medium` _(本 finding 为弱证据；需 Round 2 cross-region 复现)_
> **Status**: `open`

---

## 0. 摘要（一句话）

> 单 colo + 单 worker → 单 KV namespace 写后立即读，**40/40 reads 全 fresh**（含 delay=0ms），与 Cloudflare 公开文档"60s eventual consistency"叙述不一致；样本小（同 colo），不能直接驱动 packages/ 假设变更，但应在 `packages/storage-topology/src/adapters/scoped-io.ts:99-107` 显式标注"freshness depends on read locality"，并在 Round 2 用 cross-region / multiple-colo probe 复现。

> **⚠️ Evidence weakness (B1-code-reviewed-by-GPT §R3 downgrade, 2026-04-19)**: 本 finding 是 **Round 1 reconnaissance-level weak evidence only**，不是 KV freshness contract closure。实际 probe 只覆盖 4 delays × 10 samples = 40 reads；P0 design §4.3 原意要求的 "100 次 spread / `cacheTtl: 0` 变体 / strong-read option 验证" **均未实现**。因此本 finding **不能**被 B2 / B4 / downstream 直接读成 "KV read-after-write 已全面证明 no stale"。唯一成立的结论是："在 same-colo / same-worker / default cacheTtl / 40-sample 规模下未观察到 stale"。真 freshness contract validation 必须在 B7 round 2 配合 cacheTtl 变体 + 更高样本 + cross-colo locality 复现（见 P6 §4.1）。

---

## 1. 现象（Phenomenon）

### 1.1 复现步骤

```bash
curl -sS -X POST "https://nano-agent-spike-do-storage.haimang.workers.dev/probe/storage-kv/stale-read" \
  -H "content-type: application/json" --data '{"delays":[0,100,500,1000]}'
```

### 1.2 实际观测

| Delay | Samples | Fresh | Stale | Null | avgRead (ms) | writeLatency (ms) |
|---|---|---|---|---|---|---|
| 0 ms | 10 | **10** | 0 | 0 | 3.0 | 515 |
| 100 ms | 10 | **10** | 0 | 0 | 2.8 | 535 |
| 500 ms | 10 | **10** | 0 | 0 | 2.8 | 523 |
| 1000 ms | 10 | **10** | 0 | 0 | 2.7 | 506 |

- 所有 40 reads 返回 fresh value
- KV write latency 高（~520 ms）—— 见 unexpected-F02 候选
- KV read latency 极低（~3 ms）

### 1.3 期望与实际的差距

| 维度 | 期望（公开文档） | 实际 | 差距 |
|---|---|---|---|
| `kv.put()` → `kv.get()` 立即读 | 可能 stale (60s 窗口内) | **40/40 fresh** | 同 colo 同 worker 路径无 stale |
| 是否需要 strong-read 选项 | 文档建议 yes | spike 路径未观测到需要 | 需 cross-region 复现 |

**严重 caveat**：本 spike 是**单 worker + 单 colo + 同 KV namespace** 路径。Cloudflare KV 的 eventual consistency 主要表现在**跨 colo / 跨 region** 上。本 finding **不能直接证明 KV 全场景 strong**——只能证明同 colo 路径不需要 client-side stale 容错。

---

## 2. 根因（Root Cause）

### 2.1 直接原因

KV write 路径在同 colo 内的 read-through cache 行为可能比公开文档更激进。具体机制（KV write hot cache / colo-local replica）需要 Cloudflare side 确认，本 spike 只能给现象。

### 2.2 平台/协议/SDK 引用

| 来源 | 章节 | 关键内容 |
|---|---|---|
| Cloudflare KV docs | "How KV works" | 公开文档说 "Updates may take up to 60 seconds to propagate to other regions" |
| 实测 | `.out/2026-04-19T08-17-46Z.json` | 同 colo 同 KV ns 40/40 fresh |

### 2.3 与 packages/ 当前假设的差异

`packages/storage-topology/src/adapters/scoped-io.ts:99-107` 的 `kvGet/Put` 接口**没有任何 freshness 标注**——既不承诺 strong 也不承诺 stale。这种"沉默"在同 colo 路径下没问题，但跨 colo 会让上层代码缺乏 freshness signal。

---

## 3. 对 packages/ 的影响（Package Impact）

### 3.1 受影响文件

| 文件路径 | 行号 | 影响类型 | 说明 |
|---|---|---|---|
| `packages/storage-topology/src/adapters/scoped-io.ts` | 99-107 | **modify (doc-only)** | 在 `kvGet/Put` JSDoc 显式标注 "freshness depends on read locality; same-colo read-after-write observed strong; cross-region not yet validated (spike-do-storage-F03)" |
| `packages/storage-topology/src/adapters/kv-adapter.ts` | NEW (B2) | add | 真实 KV adapter 不需要特殊 freshness 处理（基于本 finding） |
| `packages/storage-topology/src/freshness.ts` | NEW (B2 optional) | add (optional) | 如未来 cross-region 验证暴露 stale，可加 typed `Freshness` enum；本 finding 不强制 |

### 3.2 受影响的接口契约

- [ ] Breaking change
- [x] **Non-breaking addition** (JSDoc only)
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
- [x] **filesystem.core** —— KV-backed metadata reads 需要知道 freshness contract
- [x] **context.core** —— hybrid storage tier 中 KV 承载 system / memory 层；freshness 行为决定 layer reload 策略

### 4.2 影响形态

- [ ] 阻塞
- [ ] 漂移
- [ ] 性能
- [x] **可观测性** —— context-management inspector 应能 surface freshness budget
- [x] **仅 documentation** —— packages 层只需 JSDoc

---

## 5. 写回行动（Writeback Action）

### 5.1 推荐写回路径

| 行动 | 目标 phase | 目标文件 / 模块 | 责任 owner |
|---|---|---|---|
| `kvGet/Put` JSDoc 标注 freshness 行为 | B2 | `packages/storage-topology/src/adapters/scoped-io.ts:99-107` | B2 implementer |
| 在 KvAdapter 实现 noted "no application-level retry needed for read-after-write same-colo" | B2 | `packages/storage-topology/src/adapters/kv-adapter.ts` (NEW) | B2 implementer |
| **Round 2 cross-colo 复现 probe**（关键 follow-up） | B7 | spike round-2 必备项 | spike runner |

### 5.2 写回完成的判定

- [ ] 对应 packages/ 文件已 ship（B2 future work — 仅 JSDoc）
- [ ] 对应 contract test 已新增（不需要——同 colo 测试是充分的）
- [ ] **Round 2 cross-colo probe 必须跑** (B7 future work — P6 §4.1) —— 这是确认本 finding 有效边界的硬要求

### 5.3 dismissed-with-rationale 的判定

- [ ] Finding 不成立
- [ ] Cost-benefit 不划算
- [ ] 延后到更后阶段

**重要**：本 finding **不能 dismiss**——它需要 Round 2 cross-region 复现确认。如果 Round 2 暴露 stale，必须将本 finding 升级为 **breaking change**（接口加 freshness 字段）。

---

## 6. 验证证据（Evidence）

### 6.1 原始日志 / 输出

```json
{
  "validationItemId": "V1-storage-KV-stale-read",
  "success": true,
  "timings": { "samplesN": 40, "totalDurationMs": 18192 },
  "errors": [],
  "observations": [
    {"label": "delay_0ms", "value": {"freshHits": 10, "staleHits": 0, "nullHits": 0, "writeLatencyMs": 515, "avgReadMs": 3}},
    {"label": "delay_100ms", "value": {"freshHits": 10, "staleHits": 0, "nullHits": 0, "writeLatencyMs": 535}},
    {"label": "delay_500ms", "value": {"freshHits": 10, "staleHits": 0, "nullHits": 0, "writeLatencyMs": 523}},
    {"label": "delay_1000ms", "value": {"freshHits": 10, "staleHits": 0, "nullHits": 0, "writeLatencyMs": 506}}
  ]
}
```

### 6.2 复现脚本位置

- `the historical round-1 storage spike workspace`

---

## 7. 关联关系

| 关联 finding | 关系类型 | 说明 |
|---|---|---|
| `unexpected-F02` (KV write 520 ms latency) | related-to | 同 KV binding；写延迟独立成 finding |

| 文档 | 章节 | 关系 |
|---|---|---|
| `docs/plan-after-foundations.md` | §2.2 V1-storage-KV-stale-read | validation item source |

---

## 8. 修订历史

| 日期 | 作者 | 变更 |
|---|---|---|
| 2026-04-19 | Opus 4.7 | 初版；保守结论 + 强调 Round 2 复现是硬要求 |
| 2026-04-19 (r2) | Opus 4.7 | R3 downgrade per B1-code-reviewed-by-GPT §R3: 显式标注本 finding 为 reconnaissance-level weak evidence；P0 design §4.3 原意的 cacheTtl 变体 / 100-sample spread / strong-read option 均未实现；严禁被下游读成 freshness contract closure；真 validation 留 B7 round 2 |
| 2026-04-19 (r2) | Opus 4.7 | R2 docs fix per B1-docs-reviewed-by-GPT §R2: 回收 §5.2 "Round 2 cross-colo probe 必须跑" `[x]` → `[ ]` (B7 future work) |

---

## 9. Round-2 closure (B7 integrated spike)

> **Round-2 status**: `still-open` (gated on owner/platform capability)
> **Writeback date**: 2026-04-20
> **Gate**: `F03-CROSS-COLO-DISABLED`
> **Driver**: `the historical round-2 integrated storage spike workspace`

### Round-2 evidence summary

- **used seam**: native `KVNamespace` (probe is a raw follow-up;
  re-validation layer does NOT test cross-colo because KvAdapter does
  not introduce new staleness semantics beyond the platform)
- **probe parameters**: 4 delay buckets (0 / 100 / 500 / 2000 ms),
  100 samples per bucket, both default read AND `cacheTtl: 0` variant
- **explicit gate**: the probe **refuses to run** without
  `env.F03_CROSS_COLO_ENABLED === "true"`. Same-colo substitute is
  explicitly rejected (per B7 §6.2 #3).

### Round-2 verdict

Finding remains `still-open` — the closure rubric requires
cross-colo capability which is an owner/platform property. The probe
itself is ready to run; only the gate is missing.

### Residual still-open

- `F03-CROSS-COLO-DISABLED` — owner must enable an account profile
  with 2+ colos and re-run `probe/follow-ups/kv-cross-colo-stale`.
  Without this, B8 worker-matrix should NOT rely on read-after-write
  semantics across colos.
