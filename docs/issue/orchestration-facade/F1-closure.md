# F1 Closure — Bring-up and First Roundtrip

> 阶段: `orchestration-facade / F1`
> 状态: `closed`
> 作者: `GPT-5.4`
> 时间: `2026-04-24`
> 对应 action-plan: `docs/action-plan/orchestration-facade/F1-bringup-and-first-roundtrip.md`
> 直接解锁: `docs/action-plan/orchestration-facade/F2-session-seam-completion.md`

---

## 1. 结论

F1 已达到 action-plan 约定的关闭条件。

`orchestrator-core` 现在已经作为真实 worker 资产落地，并能完成一条窄但真实的通路：**public `start` -> user DO owner -> `agent-core` guarded internal `start/stream` -> snapshot-based NDJSON relay 把 first event 带回 façade 响应**。这意味着 orchestration-facade 已经从 F0 的 freeze baseline 进入到真正的代码路径。

---

## 2. 实际交付

1. 新建 `workers/orchestrator-core/` worker，包含 package / wrangler / README / tests / per-user DO。
2. `agent-core` 新增 guarded `/internal/sessions/:id/{start,input,cancel,stream}` 路径族与 typed `invalid-internal-auth` gate。
3. `orchestrator-core` user DO 已按 F0 schema 写入最小 `SessionEntry`，并更新 `relay_cursor`。
4. 新增 `test/package-e2e/orchestrator-core/{01-preview-probe,02-session-start}.test.mjs` 与 live harness URL。
5. F1 action-plan 已切到 `executed` 并回填工作日志。

---

## 3. F2 入口条件

1. `orchestrator-core` 已不再只是壳，后续 F2 可以在它上面扩 public `input/status/timeline/ws/reconnect`。
2. `agent-core` internal route family 已存在，F2 只需补 surface 完整度，不必再 invent route/auth shape。
3. user DO 已拥有 `SessionEntry` 与 `relay_cursor`，F2 可以继续接 attach/reconnect，不必重开 schema 讨论。

---

## 4. Preview evidence

1. `agent-core` preview version: `f819b896-5d92-4a93-b2ce-9ec17686a2f3`
2. `orchestrator-core` preview version: `c7795357-e319-48a5-a72a-f302397610e5`
3. live suites passed:
   - `test/package-e2e/orchestrator-core/*.test.mjs`（F1 façade 直接证据）
   - `pnpm test:package-e2e`（仓库 package-e2e 汇总）
   - `pnpm test:cross`（仍主要覆盖 legacy `agent-core` ingress，不作为 orchestrator canonical 证据）

## 5. 最终 verdict

**F1 closed.**

当前最重要的变化不是“多了一个 worker 目录”，而是系统第一次拥有了 façade-owned public start path 与 guarded internal runtime seam。F1 的 relay 证据已经成立，但它仍是 **snapshot-based first-roundtrip proof**，不是 persistent live push；F2 之后的工作将继续在这个真实通路上扩完整 session seam。
