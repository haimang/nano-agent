# Spike Finding — `unexpected: KV write latency ~500ms`

> **Finding ID**: `unexpected-F02`
> **Spike**: `spike-do-storage` (observed during V1-storage-KV-stale-read)
> **Validation item**: (not in matrix; opportunistic observation)
> **Discovered**: 2026-04-19
> **Author**: Opus 4.7 (1M context)
> **Severity**: `medium` _(performance signal; affects hot-path KV write)_
> **Status**: `open`

---

## 0. 摘要（一句话）

> KV `put()` 在同 colo 上**平均 ~520 ms**（506 / 515 / 523 / 535），约 **170× slower than KV `get` (~3 ms)**。这是 KV 的非对称延迟特征。**对 nano-agent 设计有直接影响**：任何 hot-path 同步 KV write（如 session metadata 更新）会引入 0.5 s tail latency；context-management 的 hybrid storage tier 设计中 system / memory 层的 KV 写入应**异步化或 batch**。

---

## 1. 现象（Phenomenon）

### 1.1 复现步骤

```bash
curl -sS -X POST "https://nano-agent-spike-do-storage.haimang.workers.dev/probe/storage-kv/stale-read" \
  -H "content-type: application/json" --data '{"delays":[0,100,500,1000]}'
```

### 1.2 实际观测

| Delay | writeLatency (ms) | avgRead (ms) | Write/Read ratio |
|---|---|---|---|
| 0 | 515 | 3.0 | ~172x |
| 100 | 535 | 2.8 | ~191x |
| 500 | 523 | 2.8 | ~187x |
| 1000 | 506 | 2.7 | ~188x |

KV write 的 latency variance 很小（506-535 ms），表明这是 KV API 本身的下界，不是网络抖动。

### 1.3 期望与实际的差距

| 维度 | 期望 | 实际 |
|---|---|---|
| KV write latency | 推测 50-100 ms (cache write) | **~520 ms** |
| KV read latency | 推测 5-20 ms (edge cache) | **~3 ms** ✅ 优于期望 |
| Write/Read 对称性 | 推测 ~10x ratio | **~170-190x** |

---

## 2. 根因（Root Cause）

### 2.1 直接原因

Cloudflare KV 是 **read-heavy / write-cold** 设计：write 必须穿到 origin storage（global propagation 写入），read 从 edge cache。这是 KV 公开文档承认的特征。

### 2.2 平台/协议/SDK 引用

| 来源 | 章节 | 关键内容 |
|---|---|---|
| Cloudflare KV docs | "Performance" | "KV is optimized for high-read, low-write workloads. Writes are eventually consistent across regions." |
| 实测 | `.out/2026-04-19T08-17-46Z.json` | write ~520 ms / read ~3 ms |

### 2.3 与 packages/ 当前假设的差异

`packages/storage-topology/src/adapters/scoped-io.ts:99-107` 的 `kvPut/Get` 接口**没有 latency 标注**。`packages/context-management` (B4 计划新建) 的 hybrid tier 模型中**system / memory 层放 KV** —— 这意味着任何 system prompt / memory update 都付出 ~520 ms 代价。**必须设计 async-write 路径或 batch flush**。

---

## 3. 对 packages/ 的影响（Package Impact）

### 3.1 受影响文件

| 文件路径 | 行号 | 影响类型 | 说明 |
|---|---|---|---|
| `packages/storage-topology/src/adapters/scoped-io.ts` | 99-107 | **modify (doc-only)** | `kvPut` JSDoc 标注 "expect ~500 ms latency; use async or batch in hot path" |
| `packages/storage-topology/src/adapters/kv-adapter.ts` | NEW (B2) | add | KvAdapter 提供 `putAsync(key, value): void` (fire-and-forget with retry) helper |
| `packages/context-management/storage/kv-tier.ts` | NEW (B4) | add | hybrid tier 中 system / memory 层用 putAsync；hot path 不阻塞 |
| `packages/session-do-runtime/src/do/nano-session-do.ts` | (existing) | review | 任何 session metadata KV write 应 async |

### 3.2 受影响的接口契约

- [x] **Non-breaking addition** (`putAsync` helper)
- [ ] Breaking change
- [ ] 内部实现修改

### 3.3 是否需要协议层改动

- [x] **仅 packages/ 内部**
- [ ] 需要新增 NACP message kind
- [ ] 需要扩展现有 NACP message 字段

---

## 4. 对 worker matrix 阶段的影响（Worker-Matrix Impact）

### 4.1 哪些下一阶段 worker 会受影响

- [x] **agent.core** —— session metadata write 必须 async
- [ ] bash.core
- [x] **filesystem.core** —— KV-backed metadata write
- [x] **context.core** —— hybrid tier system / memory KV write

### 4.2 影响形态

- [x] **阻塞** —— 不修会让 hot path 引入 0.5 s tail latency
- [ ] 漂移
- [x] **性能** —— direct hot-path impact
- [ ] 可观测性

---

## 5. 写回行动（Writeback Action）

### 5.1 推荐写回路径

| 行动 | 目标 phase | 目标文件 / 模块 | 责任 owner |
|---|---|---|---|
| KvAdapter `putAsync` helper | B2 | `packages/storage-topology/src/adapters/kv-adapter.ts` | B2 implementer |
| Hybrid tier system / memory 用 putAsync | B4 | `packages/context-management/storage/kv-tier.ts` | B4 implementer |
| `kvPut` JSDoc 标注 latency | B2 | `packages/storage-topology/src/adapters/scoped-io.ts:99-107` | B2 implementer |

### 5.2 写回完成的判定

- [ ] 对应 packages/ 文件已 ship
- [ ] 对应 contract test 已新增

### 5.3 dismissed-with-rationale 的判定

- [ ] Finding 不成立
- [ ] Cost-benefit 不划算
- [ ] 延后到更后阶段

---

## 6. 验证证据（Evidence）

### 6.1 原始日志 / 输出

```
delay_0ms:    writeLatencyMs=515, avgReadMs=3.0
delay_100ms:  writeLatencyMs=535, avgReadMs=2.8
delay_500ms:  writeLatencyMs=523, avgReadMs=2.8
delay_1000ms: writeLatencyMs=506, avgReadMs=2.7
average write: ~520 ms; average read: ~2.83 ms; ratio ~184x
```

### 6.2 复现脚本位置

- `the historical round-1 storage spike workspace`

---

## 7. 关联关系

| 关联 finding | 关系类型 | 说明 |
|---|---|---|
| `spike-do-storage-F03` (KV stale-read) | causes | 同 KV binding；本 finding 是 F03 副产物 |

| 文档 | 章节 | 关系 |
|---|---|---|
| `docs/eval/after-foundations/context-management-eval-by-Opus.md` v2 | §5.3 hybrid storage | 关联 hybrid tier 设计 |

---

## 8. 修订历史

| 日期 | 作者 | 变更 |
|---|---|---|
| 2026-04-19 | Opus 4.7 | 初版；opportunistic observation during F03 |

---

## 9. Round-2 closure (B7 integrated spike)

> **Round-2 status**: `dismissed-with-rationale`
> **Writeback date**: 2026-04-20
> **Driver**: not directly re-probed; KvAdapter is not on the B7 follow-up list.

### Round-2 evidence summary

- **rationale**: Round-1 observed 500ms KV write latency at pre-seed
  time; this is an account-level property consistent with
  Cloudflare's documented KV write propagation behaviour. No
  follow-up probe would change the platform truth — the answer is
  "consumers must treat KV writes as propagation-eventual, not
  immediate-durable", which is already the stance
  `@nano-agent/storage-topology::KvAdapter` takes.
- **KV-specific re-validation was NOT on B7's follow-up list** per
  the P6 r2 design + B7 action-plan §2.1. It is consumed by B8
  worker-matrix if and when KV becomes a hot path.

### Round-2 verdict

Dismissed on rationale. KV latency is an account-scoped property;
the shipped adapter already contracts to that truth.

### Residual still-open

None. Reopen if B8 worker-matrix finds a latency-sensitive KV
consumer.
