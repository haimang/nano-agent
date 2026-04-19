# spike-do-storage — Round 1 Single-Worker Storage + Bash Platform Probe

> **Spike namespace**: `spike-do-storage`
> **Round**: 1 (bare-metal)
> **Worker name**: `nano-agent-spike-do-storage`
> **Expiration**: `2026-08-01`（业主可在 dashboard 手动销毁）
> **Design**: `docs/design/after-foundations/P0-spike-do-storage-design.md` (r2)
> **Action plan**: `docs/action-plan/after-foundations/B1-spike-round-1-bare-metal.md` (Phase 2)
> **7 条纪律**: `docs/design/after-foundations/P0-spike-discipline-and-validation-matrix.md` §3

---

## 验证目标（9 项 required validation）

### V1 storage (6 项)
- `V1-storage-R2-multipart` — R2 大对象 multipart upload 行为
- `V1-storage-R2-list-cursor` — R2 list 分页 cursor
- `V1-storage-KV-stale-read` — KV put-then-get eventual consistency window
- `V1-storage-DO-transactional` — DO state.storage transaction 行为
- `V1-storage-Memory-vs-DO` — `MemoryBackend` vs 真实 DO storage 的语义差异
- `V1-storage-D1-transaction` — D1 单 query batch + 跨 query 事务可用性

### V2 fake-bash (3 项)
- `V2A-bash-capability-parity` — 对齐 `packages/capability-runtime/src/capabilities/filesystem.ts` 的 handler contract
- `V2B-bash-platform-stress` — DO memory / cpu_ms / subrequest 边界
- `V2-bash-curl-quota` — outbound fetch quota（按业主 Q2 答需 prompt 索取测试 URL）

---

## 资源（按业主 Q1 命名约定，`nano-agent` + `spike` 双标签）

| 资源 | 名字 |
|---|---|
| Worker | `nano-agent-spike-do-storage` |
| R2 bucket | `nano-agent-spike-do-storage-probe` |
| KV namespace | `nano-agent-spike-do-storage-kv` |
| D1 database | `nano_agent_spike_do_storage_d1` |
| DO class | `ProbeDO` (binding `DO_PROBE`) |

---

## 部署

```bash
cd spikes/round-1-bare-metal/spike-do-storage
pnpm install
npx wrangler deploy --dry-run     # P1-03 syntax check
npx wrangler deploy               # P2-01 真实部署
```

---

## 销毁

业主在 CF dashboard 删除：
- Worker `nano-agent-spike-do-storage`
- R2 bucket `nano-agent-spike-do-storage-probe`
- KV namespace `nano-agent-spike-do-storage-kv`
- D1 database `nano_agent_spike_do_storage_d1`
