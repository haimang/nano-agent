# Spike Finding — `V1-storage-Memory-vs-DO`

> **Finding ID**: `spike-do-storage-F05`
> **Spike**: `spike-do-storage`
> **Validation item**: `V1-storage-Memory-vs-DO`
> **Discovered**: 2026-04-19
> **Author**: Opus 4.7 (1M context)
> **Severity**: `informational`
> **Status**: `open`

---

## 0. 摘要（一句话）

> 7-step set/get/delete 序列在 in-memory `Map` 与真实 DO storage 上产生**完全一致的 state hash 与 reads**：`stateMatch=true, readsMatch=true`。`packages/workspace-context-artifacts/src/backends/memory.ts` `MemoryBackend` 在基本 K/V 路径上是 DO storage 的 fair simulator —— B2 ship 时本地测试可以信任 `MemoryBackend`。

---

## 1. 现象（Phenomenon）

### 1.1 复现步骤

```bash
curl -sS -X POST "https://nano-agent-spike-do-storage.haimang.workers.dev/probe/storage-mem-vs-do/diff" \
  -H "content-type: application/json" --data '{}'
```

### 1.2 实际观测

跑相同 7-step 序列 (`set a=1`, `set b=2`, `get a` → `1`, `set a=1-overwritten`, `get a` → `1-overwritten`, `delete b`, `get b` → `null`)：

| Backend | state hash | reads |
|---|---|---|
| In-memory Map | `a=1-overwritten` | `["1", "1-overwritten", null]` |
| Real DO storage | `a=1-overwritten` | `["1", "1-overwritten", null]` |
| **diff** | `stateMatch=true, readsMatch=true` | ✅ |

### 1.3 期望与实际的差距

无差距。

---

## 2. 根因（Root Cause）

### 2.1 直接原因

DO `state.storage` 在基本 K/V 路径上 (`put` / `get` / `delete` / `list`) 与 in-memory Map 行为一致。本 spike 设计的 7-step 序列**仅覆盖 last-write-wins 与 delete 语义**——在更复杂场景（concurrent in-tx access / `setAlarm` 等）可能仍有差异。

### 2.2 平台/协议/SDK 引用

| 来源 | 章节 | 关键内容 |
|---|---|---|
| 实测 | `.out/2026-04-19T08-17-46Z.json` | 同序列两 backend 完全一致 |
| Cloudflare DO docs | `state.storage` API | `put` / `get` / `delete` / `list` 是基本 K/V API |

### 2.3 与 packages/ 当前假设的差异

`packages/workspace-context-artifacts/src/backends/memory.ts` 的 `MemoryBackend` 假设可作为 DO storage 的 fair simulator。本 finding **在基本 K/V 路径上确认成立**。

---

## 3. 对 packages/ 的影响（Package Impact）

### 3.1 受影响文件

| 文件路径 | 行号 | 影响类型 | 说明 |
|---|---|---|---|
| `packages/workspace-context-artifacts/src/backends/memory.ts` | (entire) | (no change) | basic K/V parity 成立 |
| `packages/workspace-context-artifacts/test/**` | (existing) | (no change) | 现有 MemoryBackend 单测可信 |

**注意**：本 finding 是 **基本路径** parity 确认，**不**包括：
- transactional behavior (covered by F04)
- size limits (covered by F08)
- cross-region behavior

后续如果出现 advanced K/V usage（如 `transactionSync`、`setAlarm`、binary value > 1 MiB），需要单独 probe + finding。

### 3.2 受影响的接口契约

- [ ] Breaking change
- [ ] Non-breaking addition
- [ ] 内部实现修改 (no change)

### 3.3 是否需要协议层改动

- [x] **仅 packages/ 内部**
- [ ] 需要新增 NACP message kind
- [ ] 需要扩展现有 NACP message 字段

---

## 4. 对 worker matrix 阶段的影响（Worker-Matrix Impact）

### 4.1 哪些下一阶段 worker 会受影响

- [ ] agent.core
- [ ] bash.core
- [x] **filesystem.core** —— 本地开发可信 MemoryBackend 模拟 DO storage
- [ ] context.core
- [ ] reserved skill.core

### 4.2 影响形态

- [ ] 阻塞
- [ ] 漂移
- [ ] 性能
- [ ] 可观测性
- [x] **仅 documentation** —— filesystem.core 设计中可声明 "MemoryBackend = fair simulator for local dev"

---

## 5. 写回行动（Writeback Action）

### 5.1 推荐写回路径

| 行动 | 目标 phase | 目标文件 / 模块 | 责任 owner |
|---|---|---|---|
| 在 `MemoryBackend` JSDoc 添加"basic K/V parity confirmed for set/get/delete in spike-do-storage-F05" | B2 | `packages/workspace-context-artifacts/src/backends/memory.ts` | B2 implementer |

### 5.2 写回完成的判定

- [ ] 对应 packages/ 文件已 ship (仅 JSDoc)
- [ ] 对应 contract test 已新增 (现有充分)

### 5.3 dismissed-with-rationale 的判定

- [ ] Finding 不成立
- [ ] Cost-benefit 不划算
- [ ] 延后到更后阶段

---

## 6. 验证证据（Evidence）

### 6.1 原始日志 / 输出

```json
{
  "validationItemId": "V1-storage-Memory-vs-DO",
  "success": true,
  "timings": { "samplesN": 1, "totalDurationMs": 1278 },
  "errors": [],
  "observations": [
    {"label": "memory_state", "value": {"state": "a=1-overwritten", "reads": ["1", "1-overwritten", null]}},
    {"label": "do_state", "value": {"state": "a=1-overwritten", "reads": ["1", "1-overwritten", null]}},
    {"label": "diff", "value": {"stateMatch": true, "readsMatch": true}}
  ]
}
```

### 6.2 复现脚本位置

- `spikes/round-1-bare-metal/spike-do-storage/src/probes/mem-vs-do.ts`
- `spikes/round-1-bare-metal/spike-do-storage/src/do/ProbeDO.ts` (handleMemVsDoProbe)

---

## 7. 关联关系

| 关联 finding | 关系类型 | 说明 |
|---|---|---|
| `spike-do-storage-F04` (DO transactional) | related-to | 同 DO storage 但更复杂语义 |
| `spike-do-storage-F08` (DO 10 MiB SQLITE_TOOBIG) | related-to | size 维度差异 |

| 文档 | 章节 | 关系 |
|---|---|---|
| `docs/plan-after-foundations.md` | §2.2 V1-storage-Memory-vs-DO | validation item source |

---

## 8. 修订历史

| 日期 | 作者 | 变更 |
|---|---|---|
| 2026-04-19 | Opus 4.7 | 初版；basic K/V parity 确认；advanced API parity 留 follow-up |
