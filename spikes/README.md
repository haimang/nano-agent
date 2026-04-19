# Nano-Agent Spikes — Disposable Cloudflare Truth Probes

> **目的**：本目录是 nano-agent after-foundations 阶段的 spike workspace。
> 这里的代码是 **disposable probes**，用于在真实 Cloudflare 环境暴露 `packages/` typed seams 与 platform reality 的差异。
> **不要**把这里的代码当作 production code；**不要**把这里的模式 promote 到 `packages/`。

---

## 当前 Round 1 (bare-metal) 内容

| Spike | 形态 | 验证目标 | 设计文档 |
|---|---|---|---|
| `round-1-bare-metal/spike-do-storage/` | 单 worker + DO + R2 + KV + D1 | 9 项 storage / fake-bash platform 验证 (V1×6 + V2×3) | `docs/design/after-foundations/P0-spike-do-storage-design.md` (r2) |
| `round-1-bare-metal/spike-binding-pair/` | 双 worker (worker-a + worker-b) | 4 项 service-binding 验证 (V3×4)，仅 fetch-based seam | `docs/design/after-foundations/P0-spike-binding-pair-design.md` (r2) |

---

## 7 条 Spike 纪律（强制遵守）

完整版见 `docs/design/after-foundations/P0-spike-discipline-and-validation-matrix.md` §3。摘要：

1. spike 代码放 `spikes/` 顶级目录，**不进** `packages/`
2. spike 必须有 expiration date（默认 `EXPIRATION_DATE=2026-08-01`）
3. spike **不接 CI 主链**（不进 `pnpm test` / `pnpm typecheck` 主路径）
4. spike 的发现必须落到 design doc，**不能只在代码注释里**（用 `docs/templates/_TEMPLATE-spike-finding.md`）
5. spike **不接生产数据 / 不持有业务数据 / 不实现新业务能力**
6. 两轮 spike 分目录：`round-1-bare-metal/` 与 `round-2-integrated/`，互不污染
7. **Round 1** 不依赖 `packages/` 的运行时实现，但**回写任务必须显式对齐 packages/ 的 seam 与 contract**

---

## 资源命名约定（业主 B1 Q1 答）

> 业主只有一个付费 CF 账号，所有 spike 资源必须带 `nano-agent` + `spike` 双标签隔离。

| 资源类型 | 命名模式 | 示例 |
|---|---|---|
| Worker name | `nano-agent-spike-{spike-name}` | `nano-agent-spike-do-storage` |
| R2 bucket | `nano-agent-spike-{spike-name}-{purpose}` | `nano-agent-spike-do-storage-probe` |
| KV namespace title | `nano-agent-spike-{spike-name}-kv` | `nano-agent-spike-do-storage-kv` |
| D1 database | `nano_agent_spike_{spike_name}_d1` (下划线) | `nano_agent_spike_do_storage_d1` |
| DO class name | `ProbeDO` (per-spike，不带前缀) | — |

---

## Expiration

- **Default expiration**: `2026-08-01`（约 charter 起算 3.5 个月）
- 业主有权在 dashboard 手动销毁；销毁前必须确认 `_DISCIPLINE-CHECK.md` 已 ship
- 业主 B1 Q5 答：spike worker 可一直保留，由业主自主销毁

---

## 部署流程

1. 进入 spike 子目录（如 `spike-do-storage/`）
2. `pnpm install`
3. `npx wrangler deploy --dry-run`（验证配置）
4. `npx wrangler deploy`（真实部署）
5. 跑 `bash scripts/run-all-probes.sh`
6. 把 `.out/YYYY-MM-DD.json` 转成 `docs/spikes/{namespace}/*.md` per-finding doc

---

## Round 2 (integrated)

`round-2-integrated/` 在本阶段（B1）尚未启动；属于 B7 的范围。
那时会把 packages/ 的 ship-after-spike 真实实现接入，验证真相是否被消化。
