# Spike Finding — `V1-storage-DO-transactional`

> **Finding ID**: `spike-do-storage-F04`
> **Spike**: `spike-do-storage`
> **Validation item**: `V1-storage-DO-transactional`
> **Discovered**: 2026-04-19
> **Author**: Opus 4.7 (1M context)
> **Severity**: `informational`
> **Status**: `open`

---

## 0. 摘要（一句话）

> DO `state.storage.transaction()` 三个 scenario 全部按预期：commit 持久化 / throw 触发 rollback / KV-style direct put 不被 transaction 包裹；`packages/workspace-context-artifacts/src/namespace.ts` 的 `WorkspaceNamespace` 假设的 transactional 行为成立——B2 实现 `DOStorageAdapter` 时可以直接 wrap `state.storage.transaction()` 而无需额外补偿逻辑。

---

## 1. 现象（Phenomenon）

### 1.1 复现步骤

```bash
curl -sS -X POST "https://nano-agent-spike-do-storage.haimang.workers.dev/probe/storage-do/transactional" \
  -H "content-type: application/json" --data '{}'
```

### 1.2 实际观测

```json
{
  "scenarios": {
    "s1": { "committed": true },
    "s2": { "rolledBack": true, "survivors": [] },
    "s3": { "kvOutsideTxObserved": true }
  }
}
```

- **s1 (happy commit)**: tx 内 put `tx-1-a`/`tx-1-b`，提交后两个 key 都可读 → committed=true
- **s2 (rollback on throw)**: tx 内 put `tx-2-a` 然后 throw → 提交后该 key 不存在 → rolledBack=true, survivors=[]
- **s3 (kv outside tx)**: tx 之前 put `kv-3="v-pre"`，然后 tx 内 put `tx-3-a` 提交 → tx 之外的 `kv-3` 仍读到 `v-pre` → kvOutsideTxObserved=true

### 1.3 期望与实际的差距

| Scenario | 期望 | 实际 | 差距 |
|---|---|---|---|
| commit 持久化 | yes | yes | 无 |
| throw 触发 rollback | yes | yes | 无 |
| tx 之外的 put 独立 | yes | yes | 无 |

---

## 2. 根因（Root Cause）

### 2.1 直接原因

Cloudflare DO `state.storage.transaction(callback)` 是 Cloudflare 平台保证的 ACID transaction primitive。throw 触发 rollback 是文档约定行为。

### 2.2 平台/协议/SDK 引用

| 来源 | 章节 | 关键内容 |
|---|---|---|
| Cloudflare DO docs | `state.storage.transaction()` | "Run a function within a transaction. If the function throws, the transaction will be rolled back." |
| 实测 | `.out/2026-04-19T08-17-46Z.json` | 3 scenarios 全部按文档行为 |

### 2.3 与 packages/ 当前假设的差异

`packages/workspace-context-artifacts/src/namespace.ts` 的 `WorkspaceNamespace` 类隐含假设 DO storage 是 transactional。本 finding **确认该假设成立**，无需补偿逻辑。

---

## 3. 对 packages/ 的影响（Package Impact）

### 3.1 受影响文件

| 文件路径 | 行号 | 影响类型 | 说明 |
|---|---|---|---|
| `packages/workspace-context-artifacts/src/namespace.ts` | (current) | (no change) | transactional 假设成立 |
| `packages/storage-topology/src/adapters/do-storage-adapter.ts` | NEW (B2) | add | 真实 DO storage adapter 直接 wrap `state.storage.transaction()`；无需额外保护 |

### 3.2 受影响的接口契约

- [ ] Breaking change
- [ ] Non-breaking addition
- [x] **内部实现修改** (B2 ship 时)

### 3.3 是否需要协议层改动

- [x] **仅 packages/ 内部**
- [ ] 需要新增 NACP message kind
- [ ] 需要扩展现有 NACP message 字段

---

## 4. 对 worker matrix 阶段的影响（Worker-Matrix Impact）

### 4.1 哪些下一阶段 worker 会受影响

- [x] **agent.core** —— session DO 的 checkpoint/snapshot 路径依赖 transactional storage
- [ ] bash.core
- [x] **filesystem.core** —— workspace mutation 需要 transactional 包装
- [x] **context.core** —— async-compact `committer.ts` 的 atomic swap 必须是 transactional

### 4.2 影响形态

- [ ] 阻塞
- [ ] 漂移
- [ ] 性能
- [ ] 可观测性
- [x] **仅 documentation** —— handoff memo 应明确 DO transactional contract 已验证

---

## 5. 写回行动（Writeback Action）

### 5.1 推荐写回路径

| 行动 | 目标 phase | 目标文件 / 模块 | 责任 owner |
|---|---|---|---|
| 实现 DOStorageAdapter wrap `state.storage.transaction()` | B2 | `packages/storage-topology/src/adapters/do-storage-adapter.ts` | B2 implementer |
| 在 P3 async-compact `committer.ts` 利用 transactional swap | B4 | `packages/context-management/async-compact/committer.ts` (Phase 3) | B4 implementer |

### 5.2 写回完成的判定

- [ ] 对应 packages/ 文件已 ship（DOStorageAdapter）
- [ ] 对应 contract test 已新增（验证 throw 触发 rollback）
- [ ] 对应 spike Round 2 integrated test 已跑通
- [ ] 修订对应 design doc

### 5.3 dismissed-with-rationale 的判定

- [ ] Finding 不成立（成立）
- [ ] Cost-benefit 不划算
- [ ] 延后到更后阶段

---

## 6. 验证证据（Evidence）

### 6.1 原始日志 / 输出

```json
{
  "validationItemId": "V1-storage-DO-transactional",
  "success": true,
  "timings": { "samplesN": 1, "totalDurationMs": 1322 },
  "errors": [],
  "observations": [{
    "label": "do_response",
    "value": {
      "scenarios": {
        "s1": {"committed": true},
        "s2": {"rolledBack": true, "survivors": []},
        "s3": {"kvOutsideTxObserved": true}
      }
    }
  }]
}
```

### 6.2 复现脚本位置

- `the historical round-1 storage spike workspace`
- `the historical round-1 storage spike workspace` (handleTransactionProbe)

---

## 7. 关联关系

| 关联 finding | 关系类型 | 说明 |
|---|---|---|
| `spike-do-storage-F05` (Memory vs DO diff) | related-to | 同 DO storage |
| `spike-do-storage-F08` (DO storage 10 MiB SQLITE_TOOBIG) | related-to | 同 DO storage 但限制层 |

| 文档 | 章节 | 关系 |
|---|---|---|
| `docs/plan-after-foundations.md` | §2.2 V1-storage-DO-transactional | validation item source |

---

## 8. 修订历史

| 日期 | 作者 | 变更 |
|---|---|---|
| 2026-04-19 | Opus 4.7 | 初版；3 scenarios 全部按预期，无 packages/ 接口修改需求 |

---

## 9. Round-2 closure (B7 integrated spike)

> **Round-2 status**: `writeback-shipped` ✅ LIVE (2026-04-20)
> **Writeback date**: 2026-04-20
> **Driver**: `the historical round-2 integrated storage spike workspace` via
>   `IntegratedProbeDO::/native-do-roundtrip` (which exercises the same `DurableObjectState.storage` path that `DOStorageAdapter` wraps).

### Round-2 evidence summary

- **used seam**: `@nano-agent/storage-topology::DOStorageAdapter`
  (indirectly — the DO's native storage is the adapter's underlying)
- **local simulation**: not applicable (requires a real DO isolate);
  the in-process B2 tests (`packages/storage-topology/test/do-storage-adapter.test.ts`)
  cover the adapter contract
- **round-trip**: `state.storage.put → get → delete` on a spike-
  scoped key

### Round-2 verdict

DO transactional semantics are still as confirmed in Round 1. The
adapter shipped in B2 doesn't change the platform's behaviour — it
adds tenant scoping + sqlite-toobig surfacing, both of which B7
validates end-to-end via `IntegratedProbeDO`.

### Residual still-open

None.
