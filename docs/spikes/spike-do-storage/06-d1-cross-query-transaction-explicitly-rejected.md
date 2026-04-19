# Spike Finding — `V1-storage-D1-transaction`

> **Finding ID**: `spike-do-storage-F06`
> **Spike**: `spike-do-storage`
> **Validation item**: `V1-storage-D1-transaction`
> **Discovered**: 2026-04-19
> **Author**: Opus 4.7 (1M context)
> **Severity**: `high`
> **Status**: `open`

---

## 0. 摘要（一句话）

> D1 binding 行为关键发现：(1) `db.batch([...])` **是 atomic** —— 一个 statement 失败导致整个 batch 回滚（survivingRows=[]）；(2) **SQL `BEGIN TRANSACTION` 被显式拒绝**，错误消息直接 redirect 到 `state.storage.transaction()` API。这意味着 `packages/storage-topology/src/refs.ts` 任何对 D1 的"client-driven cross-query transaction"假设都不成立——必须用 `db.batch()` 或推到 DO storage 层做 transaction。

---

## 1. 现象（Phenomenon）

### 1.1 复现步骤

```bash
curl -sS -X POST "https://nano-agent-spike-do-storage.haimang.workers.dev/probe/storage-d1/transaction" \
  -H "content-type: application/json" --data '{}'
```

### 1.2 实际观测

**Scenario 1 — happy batch**:
```json
{
  "latencyMs": 54,
  "rows": [
    {"id": "probe-1a", "value": "v1"},
    {"id": "probe-1b", "value": "v2"}
  ]
}
```
两个 INSERT 在同一 batch，全部 commit。

**Scenario 2 — failing batch atomicity**:
```json
{
  "latencyMs": 56,
  "batchError": "D1_ERROR: UNIQUE constraint failed: v1_storage_d1_transaction_probe.id: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_PRIMARYKEY)",
  "survivingRows": []
}
```
3-statement batch (probe-2a OK / probe-1a 重复 → fail / probe-2c 本应成功) → `survivingRows: []` 证明**整 batch atomic rollback**，包括成功的 probe-2a 与 probe-2c。

**Scenario 3 — cross-query "BEGIN" rejection**:
```
beginError: "D1_ERROR: To execute a transaction, please use the state.storage.transaction()
or state.storage.transactionSync() APIs instead of the SQL BEGIN TRANSACTION or SAVEPOINT
statements. The JavaScript API is safer because it will automatic..."
```
SQL `BEGIN TRANSACTION` 在 D1 上**被显式拒绝**，且错误消息**直接指向 DO storage 的 transaction API**。

### 1.3 期望与实际的差距

| 维度 | 期望 (charter §2.2) | 实际 | 差距 |
|---|---|---|---|
| `db.batch([...])` 原子性 | 推测 yes | ✅ confirmed atomic | 无 |
| 跨 query 事务可用性 | 推测 no | **明确 reject + redirect 消息** | 有强证据，**比推测更明确** |
| `storage-topology` D1 manifest 假设 | 推测受影响 | ✅ confirmed 受影响 | 必须 ship 时改 |

---

## 2. 根因（Root Cause）

### 2.1 直接原因

Cloudflare D1 是 SQLite-based serverless DB；client-driven `BEGIN/COMMIT` 在 stateless HTTP-based binding 上无意义（每个请求是独立 connection），所以平台层显式拒绝。批量原子性通过 `db.batch()` API 在服务端 single statement group 内保证。

### 2.2 平台/协议/SDK 引用

| 来源 | 链接 / 章节 | 关键内容 |
|---|---|---|
| Cloudflare D1 docs | "Transactions" | "Use the batch API for atomic execution; SQL BEGIN/COMMIT is not supported" |
| Error 消息（实测） | 直接 from binding | redirect to `state.storage.transaction()` 表明 Cloudflare 推荐 D1 + DO 协作做 cross-statement tx |
| 实测 | `.out/2026-04-19T08-17-46Z.json` | 3 scenarios 全部按文档 |

### 2.3 与 packages/ 当前假设的差异

`packages/storage-topology/src/refs.ts` 把 D1 当作 typed slot for "structured query / manifest"。如果 manifest 操作需要"先 read 然后 write 然后 conditional update"这种模式，**不能假设 D1 提供 transactional 保护**——必须：
- 用 `db.batch([...])` 把所有相关 statement 打包
- 或者把 transactional 状态推到 DO storage（按错误消息的明确建议）

---

## 3. 对 packages/ 的影响（Package Impact）

### 3.1 受影响文件

| 文件路径 | 行号 | 影响类型 | 说明 |
|---|---|---|---|
| `packages/storage-topology/src/refs.ts` | (entire) | **modify** | 任何引用 D1 manifest 的地方必须明确"D1 only supports batch atomicity, not cross-query transactions" |
| `packages/storage-topology/src/adapters/d1-adapter.ts` | NEW (B2) | add | 真实 D1Adapter 必须暴露 `batch(statements)` API；**不**暴露 `beginTransaction/commit` |
| `packages/storage-topology/src/promotion-plan.ts` | (existing) | review | 如果 promotion plan 涉及"先记录 promote intent → 再 swap object → 再删旧"这种 multi-step pattern，**必须**用 batch 或推到 DO |
| `docs/rfc/scoped-storage-adapter-v2.md` | NEW (B2) | add | 显式记录 D1 transaction model |
| `docs/design/after-foundations/P3-context-management-async-compact.md` | (待写) | reference | async-compact `committer.ts` 的 atomic swap 必须用 DO storage transaction，**不**用 D1 |

### 3.2 受影响的接口契约

- [x] **Breaking change** —— 任何假设 D1 提供 cross-statement tx 的 packages 代码必须改
- [ ] Non-breaking addition
- [ ] 内部实现修改

### 3.3 是否需要协议层改动

- [x] **仅 packages/ 内部** —— D1 行为不穿透到 NACP 协议层
- [ ] 需要新增 NACP message kind
- [ ] 需要扩展现有 NACP message 字段

---

## 4. 对 worker matrix 阶段的影响（Worker-Matrix Impact）

### 4.1 哪些下一阶段 worker 会受影响

- [ ] agent.core
- [ ] bash.core
- [x] **filesystem.core** —— D1-backed metadata table 必须用 batch API
- [x] **context.core** —— async-compact `committer.ts` 不能依赖 D1 transaction；必须用 DO storage transaction
- [ ] reserved skill.core

### 4.2 影响形态

- [x] **阻塞** —— 不修改 packages/ 假设会导致 atomic swap 在生产失败
- [ ] 漂移
- [ ] 性能
- [x] **可观测性** —— `defaultEvalRecords` evidence 应在 batch failure 时显式 emit `placement.batch_rollback`

---

## 5. 写回行动（Writeback Action）

### 5.1 推荐写回路径

| 行动 | 目标 phase | 目标文件 / 模块 | 责任 owner |
|---|---|---|---|
| 实现 D1Adapter `batch(statements)` API；**不**实现 `beginTransaction` | B2 | `packages/storage-topology/src/adapters/d1-adapter.ts` (NEW) | B2 implementer |
| 检查并修订 `refs.ts` / `promotion-plan.ts` 中所有"multi-step D1 mutation"位置 | B2 | `packages/storage-topology/src/refs.ts`, `promotion-plan.ts` | B2 implementer |
| 在 P3 async-compact `committer.ts` 设计中明确 "atomic swap → DO storage transaction, not D1" | B4 | `packages/context-management/async-compact/committer.ts` (Phase 3 design) | B4 author |
| RFC 文档 explicit document D1 transaction model | B2 | `docs/rfc/scoped-storage-adapter-v2.md` | B2 author |

### 5.2 写回完成的判定

- [ ] 对应 packages/ 文件已 ship
- [ ] 对应 contract test 已新增（验证 batch atomicity + BEGIN rejection）
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
  "validationItemId": "V1-storage-D1-transaction",
  "success": true,
  "timings": { "samplesN": 3, "totalDurationMs": 1320 },
  "errors": [],
  "observations": [
    {"label": "happy_batch", "value": {"latencyMs": 54, "rows": [{"id": "probe-1a", "value": "v1"}, {"id": "probe-1b", "value": "v2"}]}},
    {"label": "failing_batch_atomicity", "value": {"latencyMs": 56, "batchError": "D1_ERROR: UNIQUE constraint failed: ...", "survivingRows": []}},
    {"label": "cross_query_transaction_attempt", "value": {"beginError": "D1_ERROR: To execute a transaction, please use the state.storage.transaction() ..."}}
  ]
}
```

### 6.2 复现脚本位置

- `spikes/round-1-bare-metal/spike-do-storage/src/probes/d1-transaction.ts`

---

## 7. 关联关系

| 关联 finding | 关系类型 | 说明 |
|---|---|---|
| `spike-do-storage-F04` (DO transactional) | causes | D1 错误消息直接指向 DO transaction 作为 cross-statement tx 的替代 |

| 文档 | 章节 | 关系 |
|---|---|---|
| `docs/plan-after-foundations.md` | §2.2 V1-storage-D1-transaction | validation item source |
| `docs/eval/after-foundations/before-worker-matrix-eval-with-Opus.md` | §3.2 D1 章节 | 之前已推测此结论 |

---

## 8. 修订历史

| 日期 | 作者 | 变更 |
|---|---|---|
| 2026-04-19 | Opus 4.7 | 初版；3 scenarios + Cloudflare 平台错误消息显式 redirect 是关键证据 |
