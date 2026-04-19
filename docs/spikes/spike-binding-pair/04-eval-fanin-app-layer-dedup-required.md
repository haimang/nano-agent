# Spike Finding — `V3-binding-eval-fanin`

> **Finding ID**: `spike-binding-pair-F04`
> **Spike**: `spike-binding-pair`
> **Validation item**: `V3-binding-eval-fanin`
> **Transport scope**: `fetch-based-seam`
> **Discovered**: 2026-04-19
> **Author**: Opus 4.7 (1M context)
> **Severity**: `high` _(forces packages/ contract: app-layer dedup is mandatory)_
> **Status**: `open`

---

## 0. 摘要（一句话）

> Fan-in 100-record 单 batch order 完整保留；3 round × 20 records w/ shared dedupSeed → **60 records 但 40 重复**（unique=20，**`applicationLevelDedupRequired: true`**）；overflow drop graceful (50/100 dropped at capacity 50)。**这是对 `packages/eval-observability/src/inspector.ts` 的 `SessionInspector` 与 `defaultEvalRecords` sink 的硬 contract requirement**：任何跨 worker fan-in 设计必须显式 messageUuid dedup，**不能依赖 transport 提供 dedup**。

> **⚠️ Scope caveat (B1-code-reviewed-by-GPT §R1 downgrade, 2026-04-19)**: probe 的实际 flow 是 **worker-a 主动 `fetch("/handle/eval-emit")` 拉回 records 后本地 ingest**，不是 worker-b 通过 service-binding callback 把 records push 到 worker-a 暴露的 sink endpoint。因此本 finding 验证的是 **response-batch simulation semantics**（fetch 响应体的顺序/去重特征），**不是** cross-worker sink-callback semantics（worker-b push → worker-a sink 的交付顺序/重入/回压）。两种语义的 dedup 结论在本 finding 的 context 下一致（transport 不去重；应用层必须去重），但 callback 方向的 ordering / backpressure / fan-out 回压行为**尚未验证**。真 callback sink path 的验证**推迟到 B7 round 2 integrated spike**（见 P6 §4）。

---

## 1. 现象（Phenomenon）

### 1.0 Probe semantics clarification (R1 downgrade)

当前 probe 实现 flow：worker-a → `workerB.fetch("/handle/eval-emit", { body: { count, dedupSeed, ... } })` → worker-b 同步生成 N 条 `EvidenceRecord` → worker-a 从 **response body** 拿回 records 后 `ingest(sink, body.records)`。

**不是** (design §4.4 最初意图 + B7 round 2 目标)：worker-b 通过 **反向 service binding** 把 evidence push 到 worker-a 暴露的 sink endpoint.

因此本 finding 所有观察适用于 **response-batch 语义**；真 callback sink 语义留 B7 复现.

### 1.1 复现步骤

```bash
curl -sS -X POST "https://nano-agent-spike-binding-pair-a.haimang.workers.dev/probe/binding-eval-fanin" \
  -H "content-type: application/json" --data '{}'
```

### 1.2 实际观测

**Single batch ordering** (100 records):
```json
{
  "requested": 100,
  "ingested": 100,
  "roundTripMs": 6,
  "orderPreserved": true,
  "firstSeq": 0,
  "lastSeq": 99
}
```
单 batch 内 order 完整保持。

**Dedup with shared seed** (3 rounds × 20 records, shared dedupSeed):
```json
{
  "rounds": 3,
  "recordsPerRound": 20,
  "total": 60,
  "unique": 20,
  "duplicates": 40,
  "applicationLevelDedupRequired": true
}
```
**Transport 不去重**——3 个 batch 即使 messageUuid 完全相同，全部 60 条都到达。

**Fan-in 3 rounds** (different dedupSeeds):
```json
{
  "rounds": [
    {"round": 0, "firstSeq": 0, "lastSeq": 29, "ms": 4},
    {"round": 1, "firstSeq": 0, "lastSeq": 29, "ms": 4},
    {"round": 2, "firstSeq": 0, "lastSeq": 29, "ms": 5}
  ],
  "totalIngested": 90,
  "perRoundOrderPreserved": true
}
```
每 round seq 重置（设计如此）；round-internal order 保持；跨 round order 无 global guarantee。

**Sink overflow**:
```json
{
  "capacity": 50,
  "attempted": 100,
  "ingested": 50,
  "droppedDueToOverflow": 50
}
```
超 capacity 时**静默 drop**——本 spike 实现的 in-mem sink 没有 emit overflow disclosure event。

### 1.3 期望与实际的差距

| 维度 | 期望 | 实际 | 差距 |
|---|---|---|---|
| 单 batch ordering | yes | ✅ | 无 |
| Transport 自动 dedup | 推测 no | **confirmed no** | 无（按预期） |
| 跨 round global ordering | 推测 no | confirmed no | 无 |
| Sink overflow graceful | yes | ✅ count tracked but **no disclosure event** | 需补 disclosure |

---

## 2. 根因（Root Cause）

### 2.1 直接原因

Service binding fetch-based seam 是无状态的 RPC——transport 层没有任何"曾经见过这个 messageUuid"的记忆。Dedup 必须在**接收端 application 层**做。

### 2.2 平台/协议/SDK 引用

| 来源 | 章节 | 关键内容 |
|---|---|---|
| `packages/eval-observability/src/inspector.ts:78` | code | `SessionInspector` 当前消费 9 canonical session.stream.event |
| `packages/session-do-runtime/src/do/nano-session-do.ts` | (existing) | `defaultEvalRecords` 是 1024-cap bounded array sink |
| 实测 | `.out/2026-04-19T08-28-14Z.json` | 60 records / 20 unique → 40 duplicates 全部到达 |

### 2.3 与 packages/ 当前假设的差异

`packages/eval-observability` 当前**没有**显式的 dedup logic。如果 nano-agent 在 worker matrix 阶段做跨 worker evidence emit（如 bash.core / context.core 把 evidence emit 回 agent.core 的 sink），**必须**在 sink 入口做 messageUuid dedup，否则会有大量重复 audit log。

---

## 3. 对 packages/ 的影响（Package Impact）

### 3.1 受影响文件

| 文件路径 | 行号 | 影响类型 | 说明 |
|---|---|---|---|
| `packages/eval-observability/src/inspector.ts` | 78+ | **modify** | `SessionInspector` 入口加 messageUuid-based dedup（默认 enabled） |
| `packages/session-do-runtime/src/do/nano-session-do.ts` | (defaultEvalRecords) | **modify** | `defaultEvalRecords` sink 入口同款 dedup；overflow 时 emit 显式 disclosure event（如 `eval.sink.overflow_drop`） |
| `packages/hooks/src/catalog.ts` | (B5 P4 expansion) | enhance | 考虑加 `EvalSinkOverflow` event 为 hook catalog 一员 (待 B5 design) |
| `docs/design/after-foundations/P3-context-management-inspector.md` | (待写) | reference | inspector facade 消费 dedup'd stream |

### 3.2 受影响的接口契约

- [x] **Non-breaking addition** —— 现有 stream consumer 不感知 dedup（dedup 在 sink 入口）
- [ ] Breaking change
- [ ] 内部实现修改

### 3.3 是否需要协议层改动

- [x] **仅 packages/ 内部** —— dedup 是 sink-internal concern，不穿透到 NACP
- [ ] 需要新增 NACP message kind
- [ ] 需要扩展现有 NACP message 字段

---

## 4. 对 worker matrix 阶段的影响（Worker-Matrix Impact）

### 4.1 哪些下一阶段 worker 会受影响

- [x] **agent.core** —— sink 入口必须 dedup
- [x] **bash.core** —— 跨 worker emit evidence 时不能假设 transport 去重
- [x] **filesystem.core**
- [x] **context.core** —— async-compact lifecycle event 跨 worker emit 时同款约束

### 4.2 影响形态

- [x] **阻塞** —— 不修会让生产 audit log 出现大量 duplicate
- [ ] 漂移
- [x] **性能** —— overflow disclosure 必须显式（避免 silent drop）
- [x] **可观测性** —— 这条本身是 observability 类 finding

---

## 5. 写回行动（Writeback Action）

### 5.1 推荐写回路径

| 行动 | 目标 phase | 目标文件 / 模块 | 责任 owner |
|---|---|---|---|
| `SessionInspector` 入口加 messageUuid dedup | B6 | `packages/eval-observability/src/inspector.ts` | B6 implementer |
| `defaultEvalRecords` sink 入口同款 dedup + overflow disclosure event | B6 | `packages/session-do-runtime/src/do/nano-session-do.ts` | B6 implementer |
| Phase 4 hook catalog 扩展时考虑 `EvalSinkOverflow` event | B5 | `packages/hooks/src/catalog.ts` | B5 implementer |
| Phase 3 inspector facade design 引用本 finding | B4 | `docs/design/after-foundations/P3-context-management-inspector.md` | B4 author |

### 5.2 写回完成的判定

- [ ] 对应 packages/ 文件已 ship
- [ ] 对应 contract test 已新增（验证 shared messageUuid 重复 emit 时 sink 只保留 1 份）
- [ ] 对应 spike Round 2 integrated test 已跑通
- [ ] 修订对应 design doc

### 5.3 dismissed-with-rationale 的判定

- [ ] Finding 不成立
- [ ] Cost-benefit 不划算
- [ ] 延后到更后阶段

---

## 6. 验证证据（Evidence）

### 6.1 原始日志 / 输出

```json
{
  "validationItemId": "V3-binding-eval-fanin",
  "transportScope": "fetch-based-seam",
  "success": true,
  "observations": [
    {"label": "single_batch_ordering", "value": {"requested": 100, "ingested": 100, "roundTripMs": 6, "orderPreserved": true, "firstSeq": 0, "lastSeq": 99}},
    {"label": "dedup_with_shared_seed", "value": {"rounds": 3, "recordsPerRound": 20, "total": 60, "unique": 20, "duplicates": 40, "applicationLevelDedupRequired": true}},
    {"label": "fanin_three_rounds", "value": {"rounds": [{"round": 0, "firstSeq": 0, "lastSeq": 29, "ms": 4}, {"round": 1, "firstSeq": 0, "lastSeq": 29, "ms": 4}, {"round": 2, "firstSeq": 0, "lastSeq": 29, "ms": 5}], "totalIngested": 90, "perRoundOrderPreserved": true}},
    {"label": "sink_overflow", "value": {"capacity": 50, "attempted": 100, "ingested": 50, "droppedDueToOverflow": 50}}
  ]
}
```

### 6.2 复现脚本位置

- `spikes/round-1-bare-metal/spike-binding-pair/worker-a/src/probes/eval-fanin.ts`
- `spikes/round-1-bare-metal/spike-binding-pair/worker-b/src/handlers/eval-emit.ts`

---

## 7. 关联关系

| 关联 finding | 关系类型 | 说明 |
|---|---|---|
| `spike-binding-pair-F01` (latency) | related-to | 同 transport |

| 文档 | 章节 | 关系 |
|---|---|---|
| `docs/plan-after-foundations.md` | §2.2 V3-binding-eval-fanin | validation item source |
| `docs/eval/after-foundations/context-management-eval-by-Opus.md` v2 | §3.6 Inspector | 关联 Phase 3 inspector facade |

---

## 8. 修订历史

| 日期 | 作者 | 变更 |
|---|---|---|
| 2026-04-19 | Opus 4.7 | 初版；app-layer dedup is mandatory；overflow disclosure event needed |
| 2026-04-19 (r2) | Opus 4.7 | R1 downgrade per B1-code-reviewed-by-GPT §R1: add scope caveat 说明 probe flow 是 response-batch simulation 而非真 cross-worker sink callback；真 callback 验证推迟到 B7 round 2 (P6 §4 新增 follow-up) |
