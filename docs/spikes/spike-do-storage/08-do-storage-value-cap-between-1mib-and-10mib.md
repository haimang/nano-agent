# Spike Finding — `V2B-bash-platform-stress`

> **Finding ID**: `spike-do-storage-F08`
> **Spike**: `spike-do-storage`
> **Validation item**: `V2B-bash-platform-stress`
> **Discovered**: 2026-04-19
> **Author**: Opus 4.7 (1M context)
> **Severity**: `high`
> **Status**: `open`

---

## 0. 摘要（一句话）

> DO `state.storage.put(key, Uint8Array(N))` 在 N=10 MiB 时**触发 `SQLITE_TOOBIG`**，N=1 MiB 成功（45 ms）；上限在 1-10 MiB 之间（精确值待 follow-up probe）。**对 `packages/context-management/async-compact/` 的 budget policy 与 `packages/capability-runtime` 的 fake-bash quota guard 都构成硬约束**：任何把 large blob 直接放 DO storage 的设计必须先过 size cap check + 走 R2 promotion 路径。

---

## 1. 现象（Phenomenon）

### 1.1 复现步骤

```bash
curl -sS -X POST "https://nano-agent-spike-do-storage.haimang.workers.dev/probe/bash/platform-stress" \
  -H "content-type: application/json" --data '{}'
```

### 1.2 实际观测

**Memory probe**:

| Size | Result | Latency (ms) |
|---|---|---|
| 1 KiB | `wrote=true, readBack=true` | 1240 (含 ProbeDO cold start) |
| 100 KiB | `wrote=true, readBack=true` | 40 |
| 1 MiB | `wrote=true, readBack=true` | 45 |
| **10 MiB** | **`ok=false, error="string or blob too big: SQLITE_TOOBIG"`** | 39 |

**CPU scan probe** (key seed + scan):

| keyCount | Latency (ms) | matchCount | scanWallMs |
|---|---|---|---|
| 10 | 36 | 2 | 0 |
| 100 | 39 | 15 | 0 |
| 500 | 49 | 72 | 0 |

`scanWallMs=0` —— scan over 500 keys 在 ms 级别内完成，**远未触及 cpu_ms 上限**。

### 1.3 期望与实际的差距

| 维度 | 期望（charter §2.2 推测） | 实际 | 差距 |
|---|---|---|---|
| DO memory 上限 | 推测 ~128 MiB (Worker memory cap) | **per-value cap ~1-10 MiB** (SQLITE_TOOBIG) | **更严格的 per-value 上限** |
| cpu_ms 触发 | 推测 ~50ms 在 rg 大目录 | 500 key scan in 0ms wall | 远未触发 |

---

## 2. 根因（Root Cause）

### 2.1 直接原因

DO storage 在 SQLite-backed mode（current default）下，**单 value 大小受 SQLite `SQLITE_MAX_LENGTH` 限制**。SQLite 默认 `SQLITE_MAX_LENGTH = 1 GiB`，但 Cloudflare DO 设了更小的值——根据本 spike 实测，10 MiB 已超出。**实际 limit 在 1-10 MiB 之间**——需要 binary-search probe 确定精确数字。

### 2.2 平台/协议/SDK 引用

| 来源 | 章节 | 关键内容 |
|---|---|---|
| SQLite docs | `SQLITE_MAX_LENGTH` | 单 value 默认 1 GiB |
| Cloudflare DO docs | "Storage limits" | per-value cap (具体数字未在公开文档详细说明) |
| 实测 | `.out/2026-04-19T08-17-46Z.json` | 1 MiB ✅ / 10 MiB → SQLITE_TOOBIG |

### 2.3 与 packages/ 当前假设的差异

`packages/workspace-context-artifacts/src/backends/memory.ts` 的 `MemoryBackend` **没有 size cap**——意味着本地测试 OK 的 10 MiB blob，部署到 DO 后会失败。这是 `MemoryBackend ≠ DO storage` 的**第一个真实差异**（与 spike-do-storage-F05 互补）。

---

## 3. 对 packages/ 的影响（Package Impact）

### 3.1 受影响文件

| 文件路径 | 行号 | 影响类型 | 说明 |
|---|---|---|---|
| `packages/storage-topology/src/adapters/do-storage-adapter.ts` | NEW (B2) | add | DOStorageAdapter `put` 必须暴露 size pre-check 或 typed `ValueTooLargeError` |
| `packages/workspace-context-artifacts/src/backends/memory.ts` | (current) | **modify** | 添加可选 `maxValueBytes` 配置；默认设 1 MiB（与 DO 上限保持安全 margin）；超限时 throw 与真实 DO 相同的 error shape |
| `packages/workspace-context-artifacts/src/promotion.ts` | (existing) | review | promotion 路径必须把 > 1 MiB 的 blob 强制走 R2，**不**让它落 DO storage |
| `packages/context-management/async-compact/` | NEW (B4) | design constraint | summary blob 如果 > 1 MiB 必须分片或先存 R2 + 在 DO 存 ref |
| `packages/capability-runtime/src/capabilities/filesystem.ts` | (current) | review | `write` capability 在写入前应有 size check（防止 LLM 一次写入巨大文件触发 platform error） |

### 3.2 受影响的接口契约

- [x] **Non-breaking addition** —— 接口加 size hint 字段；不破坏现有 `put(key, body)` 签名
- [ ] Breaking change
- [ ] 内部实现修改

### 3.3 是否需要协议层改动

- [x] **仅 packages/ 内部** —— size limit 是 storage-internal concern
- [ ] 需要新增 NACP message kind
- [ ] 需要扩展现有 NACP message 字段

---

## 4. 对 worker matrix 阶段的影响（Worker-Matrix Impact）

### 4.1 哪些下一阶段 worker 会受影响

- [ ] agent.core
- [x] **bash.core** —— `write` capability 必须有 size pre-check
- [x] **filesystem.core** —— promotion 决策必须基于 size threshold
- [x] **context.core** —— async-compact summary 必须 size-aware
- [ ] reserved skill.core

### 4.2 影响形态

- [x] **阻塞** —— 不修无法启动 large file scenario
- [ ] 漂移
- [x] **性能** —— size-aware routing 影响 hot path latency
- [x] **可观测性** —— `defaultEvalRecords` 应 emit `placement.size_cap_triggered` 类 event

---

## 5. 写回行动（Writeback Action）

### 5.1 推荐写回路径

| 行动 | 目标 phase | 目标文件 / 模块 | 责任 owner |
|---|---|---|---|
| 在 DOStorageAdapter `put` 加 size pre-check + typed `ValueTooLargeError` | B2 | `packages/storage-topology/src/adapters/do-storage-adapter.ts` | B2 implementer |
| 修订 `MemoryBackend` 加 `maxValueBytes` config + match DO error shape | B2 | `packages/workspace-context-artifacts/src/backends/memory.ts` | B2 implementer |
| 检查 `promotion.ts` size threshold 决策 | B2 | `packages/workspace-context-artifacts/src/promotion.ts` | B2 implementer |
| 在 P3 async-compact 设计约束 size-aware | B4 | `docs/design/after-foundations/P3-context-management-async-compact.md` | B4 author |
| **追加 binary-search probe** 确定 1-10 MiB 之间的精确上限 | Phase 6 (Round 2) | spike re-run | spike runner |

### 5.2 写回完成的判定

- [ ] 对应 packages/ 文件已 ship（DOStorageAdapter + MemoryBackend）
- [ ] 对应 contract test 已新增（size cap rejection）
- [ ] 对应 spike Round 2 integrated test 已跑通（包含精确上限 probe）
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
  "validationItemId": "V2B-bash-platform-stress",
  "success": true,
  "observations": [
    {"label": "memory_1024b", "value": {"sizeBytes": 1024, "latencyMs": 1240, "wrote": true, "readBack": true}},
    {"label": "memory_102400b", "value": {"sizeBytes": 102400, "latencyMs": 40, "wrote": true, "readBack": true}},
    {"label": "memory_1048576b", "value": {"sizeBytes": 1048576, "latencyMs": 45, "wrote": true, "readBack": true}},
    {"label": "memory_10485760b", "value": {"sizeBytes": 10485760, "latencyMs": 39, "ok": false, "error": "string or blob too big: SQLITE_TOOBIG"}},
    {"label": "cpu_scan_10_keys", "value": {"keyCount": 10, "matchCount": 2, "scanWallMs": 0}},
    {"label": "cpu_scan_100_keys", "value": {"keyCount": 100, "matchCount": 15, "scanWallMs": 0}},
    {"label": "cpu_scan_500_keys", "value": {"keyCount": 500, "matchCount": 72, "scanWallMs": 0}}
  ]
}
```

### 6.2 复现脚本位置

- `spikes/round-1-bare-metal/spike-do-storage/src/probes/bash-platform-stress.ts`
- `spikes/round-1-bare-metal/spike-do-storage/src/do/ProbeDO.ts` (handleStressMemory + handleStressCpuScan)

---

## 7. 关联关系

| 关联 finding | 关系类型 | 说明 |
|---|---|---|
| `spike-do-storage-F04` (DO transactional) | related-to | 同 DO storage |
| `spike-do-storage-F05` (Mem vs DO parity) | causes | DO size cap is the FIRST observed real diff between MemoryBackend and DO |

| 文档 | 章节 | 关系 |
|---|---|---|
| `docs/plan-after-foundations.md` | §2.2 V2 | validation item source |

---

## 8. 修订历史

| 日期 | 作者 | 变更 |
|---|---|---|
| 2026-04-19 | Opus 4.7 | 初版；1-10 MiB 区间需要 binary-search follow-up probe |
