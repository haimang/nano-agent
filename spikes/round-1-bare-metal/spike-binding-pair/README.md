# spike-binding-pair — Round 1 Two-Worker Service-Binding Probe

> **Spike namespace**: `spike-binding-pair`
> **Round**: 1 (bare-metal)
> **Workers**: `nano-agent-spike-binding-pair-a` (caller) + `nano-agent-spike-binding-pair-b` (callee)
> **Expiration**: `2026-08-01`
> **Design**: `docs/design/after-foundations/P0-spike-binding-pair-design.md` (r2)
> **Action plan**: `docs/action-plan/after-foundations/B1-spike-round-1-bare-metal.md` (Phase 3)
> **7 条纪律**: `docs/design/after-foundations/P0-spike-discipline-and-validation-matrix.md` §3

---

## Transport scope（重要！）

> **本 spike 仅验证 `session-do-runtime` 当前 load-bearing 的 fetch-based seam**（`packages/session-do-runtime/src/remote-bindings.ts:64-77, 282`）。
>
> **不**验证 `packages/nacp-core/src/transport/service-binding.ts:15-16` 的 `ServiceBindingTarget.handleNacp(envelope)` RPC transport——如需要应单独立项 `spike-rpc-transport`。

---

## 验证目标（4 项 required validation）

- `V3-binding-latency-cancellation` — service binding latency / cancellation / timeout / retry
- `V3-binding-cross-seam-anchor` — 5 个 `x-nacp-*` headers 跨 binding 透传
- `V3-binding-hooks-callback` — 跨 worker hook dispatch latency
- `V3-binding-eval-fanin` — 跨 worker evidence emit ordering / dedup

---

## 资源

| 资源 | 名字 |
|---|---|
| Worker A (caller) | `nano-agent-spike-binding-pair-a` |
| Worker B (callee) | `nano-agent-spike-binding-pair-b` |
| Service binding (in worker-a) | `WORKER_B` → `nano-agent-spike-binding-pair-b` |

> 不需要 KV / R2 / DO / D1 —— 本 spike 只测 binding。

---

## 部署顺序（强制）

```bash
cd spikes/round-1-bare-metal/spike-binding-pair

# 1. 必须先部署 worker-b
cd worker-b && npx wrangler deploy && cd ..

# 2. 再部署 worker-a（service binding 引用 worker-b 名字）
cd worker-a && npx wrangler deploy && cd ..

# 跨 worker probe
bash scripts/run-all-probes.sh
```

`scripts/deploy-both.sh` 会自动 enforce 上述顺序。

---

## 销毁

业主在 CF dashboard 删除：
- Worker `nano-agent-spike-binding-pair-a`
- Worker `nano-agent-spike-binding-pair-b`
