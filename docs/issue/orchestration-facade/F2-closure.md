# F2 Closure — Session Seam Completion

> 阶段: `orchestration-facade / F2`
> 状态: `closed`
> 作者: `GPT-5.4`
> 时间: `2026-04-24`
> 对应 action-plan: `docs/action-plan/orchestration-facade/F2-session-seam-completion.md`
> 直接解锁: `docs/action-plan/orchestration-facade/F3-canonical-cutover-and-legacy-retirement.md`

---

## 1. 结论

F2 已达到 action-plan 的关闭条件。

`orchestrator-core` 现在不再只是“能 start 一次”的 façade，而是 first-wave 的完整 session owner：public route family 已补齐，user DO 已拥有 lifecycle / retention / WS supersede / reconnect 基础纪律，preview live 证据也已成立。需要同时明确：当前 `/internal/stream` 仍是 **snapshot-over-NDJSON relay**，而不是持续 push 的 live stream。

---

## 2. 实际交付

1. façade session routes 已补齐：`start/input/cancel/status/timeline/verify/ws`
2. `agent-core` internal routes 已补齐：`start/input/cancel/status/timeline/verify/stream`
3. user DO 已实现：
   - `SessionEntry` 状态流转
   - `24h + 100` ended retention
   - `session_terminal` / `session_missing`
   - single active writable attachment + `attachment_superseded`
4. orchestrator live suite 已扩到：
   - ws attach
   - reconnect
   - route family (`input/status/timeline/verify/cancel`)
5. probe marker 已切到 `orchestration-facade-F2`

---

## 3. F3 入口条件

1. `orchestrator-core` 已具备承接 canonical public ingress 的真实 session seam，不必再回头补 façade owner 基座。
2. legacy `agent-core /sessions/*` 在 F2 结束时仍与 façade additive 共存；F3 的核心工作是把这条仍然工作的 legacy surface hard deprecate 并 cutover。
3. docs / tests / live harness 已具备迁移到 orchestrator edge 的基础，但 `test:cross` 在 F2 结束时仍主要验证 legacy `agent-core` ingress。

---

## 4. Preview evidence

1. `agent-core` preview version: `23ffe916-20bf-4d68-aaae-34bbcd980db3`
2. `orchestrator-core` preview version: `14596ab9-5645-45f9-9613-c87832c00465`
3. live suites passed:
   - `test/package-e2e/orchestrator-core/*.test.mjs`（F2 façade 直接证据）
   - `pnpm test:package-e2e` (`29/29`)（仓库 package-e2e 汇总）
   - `pnpm test:cross` (`40/40`)（仍主要走 legacy `agent-core` ingress，不作为 orchestrator canonical 证据）

## 5. 最终 verdict

**F2 closed.**

现在最关键的变化不是“多了几个 façade route”，而是 `orchestrator-core` 第一次真正承担起 first-wave session ownership。F3 之后的 cutover 将建立在真实 public edge 上，而不是建立在 F1 的 narrow roundtrip 假设上；与此同时，live push relay 仍属于下一阶段增强，而非 F2 已完成事实。
