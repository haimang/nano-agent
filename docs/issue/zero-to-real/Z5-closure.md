# Z5 Closure — Closure and Handoff

> 阶段: `zero-to-real / Z5`
> 状态: `closed`
> 作者: `GPT-5.4`
> 时间: `2026-04-25`
> 对应 action-plan: `docs/action-plan/zero-to-real/Z5-closure-and-handoff.md`
> 直接解锁: `docs/handoff/zero-to-real-to-next-phase.md`

---

## 1. 结论

Z5 已达到 action-plan 约定的关闭条件。

zero-to-real 现在不再只是“Z0-Z4 各自有 closure”的松散阶段，而是已经被压成一个可审计、可交接、可继续消费的闭合包：**charter exit criteria 已逐条复核，preview live smoke 与 D1 SQL 证据已补做，remaining residuals 已被压成明确 backlog，next-phase handoff 已具备直接消费形态。**

---

## 2. Completion audit 摘要

| phase | 当前结论 | 本轮复核重点 |
| --- | --- | --- |
| Z0 | `closed` | freeze baseline、action-plan chain、validation baseline 固定 |
| Z1 | `closed` | internal-only `orchestrator-auth`、Wave A identity core、`/auth/*` façade 成立 |
| Z2 | `closed` | D1 session truth、activity/audit baseline、DO hot-state、RPC kickoff 成立 |
| Z3 | `closed` | Workers AI mainline、quota dual gate、`nano_usage_events` durable truth 成立 |
| Z4 | `closed` | real-client baseline、live LLM/quota anchor、review-fixed transport baseline 成立 |
| Z5 | `closed` | final verdict、handoff pack、residual register 成立 |

---

## 3. Charter exit criteria 复核

### criterion 1 — 完整 end-user auth truth 已成立

- **状态**：✅
- **证据**：
  1. `workers/orchestrator-auth/src/index.ts` 以 `WorkerEntrypoint` 暴露 `register/login/refresh/me/verify/reset/wechat` RPC surface。
  2. `workers/orchestrator-core/src/index.ts` 通过 `env.ORCHESTRATOR_AUTH.*` 走 internal-only auth binding，不依赖 public auth worker route。
  3. `docs/issue/zero-to-real/Z1-closure.md` 已确认 email/password、WeChat、JWT/refresh、tenant readback baseline。
  4. server-to-server API key verify 当前未启用，因此不把 `verifyApiKey` reserved surface 误写成 blocker。

### criterion 2 — multi-tenant / NACP compliance 成为 runtime truth

- **状态**：✅
- **证据**：
  1. public ingress 强制 `trace_uuid`、JWT 与 tenant claim。
  2. internal ingress 强制 internal secret、authority payload、no-escalation。
  3. Z2/Z3/Z4 review-fix 已收紧 deploy-fill runtime truth，并补齐对应负例测试。

### criterion 3 — session truth 已持久化

- **状态**：✅
- **证据**：
  1. Wave B D1 baseline 已落地：`nano_conversation_sessions / turns / messages / context_snapshots / nano_session_activity_logs`。
  2. `workers/orchestrator-core/src/user-do.ts` 已拥有 conversation index、recent frames、status/verify cache、history/timeline durable readback。
  3. `orchestration.core -> agent.core` control-plane RPC 已启动，且 `status/start` 已具备不再重入原始 `/internal/*` router 的 kickoff path。

### criterion 4 — real runtime 已成立

- **状态**：✅
- **证据**：
  1. Workers AI 已成为 mainline provider。
  2. quota dual gate 已进入 llm/tool 主路径。
  3. `nano_usage_events` 已保留 `provider_key='workers-ai'` 的 durable usage lineage。

### criterion 5 — real clients 已闭合

- **状态**：✅（first-wave baseline）
- **证据**：
  1. `clients/web` 与 `clients/wechat-miniprogram` 都已具备 login/start/input/ws/timeline 的真实路由消费代码。
  2. Z4 review-fix 后，两端都已补 `last_seen_seq`、`session.resume`、heartbeat、ACK、typed error disclosure。
  3. 当前 public/runtime path 的 live package/cross-e2e 已通过，因此客户端所依赖的后端真链路不是 mock。
- **保留说明**：
  - browser / WeChat devtools manual evidence 仍未建立，因此这里的 “闭合” 明确只指 **first-wave real-client baseline**，不夸大为产品级客户端完成。

### criterion 6 — 剩余问题已被压成明确 backlog

- **状态**：✅
- **证据**：
  1. Z4 residual inventory 已存在。
  2. 本文 §5 已把 closeout 后的剩余项按优先级压成统一 register。
  3. 当前不再存在“first real run 是否已成立”这一类未定义大项。

---

## 4. Z5 补充验证

### 4.1 本地回归矩阵

本轮在写 final closure 之前，重新跑过一轮 broad local validation：

1. `pnpm --filter @haimang/orchestrator-auth-worker typecheck`
2. `pnpm --filter @haimang/orchestrator-auth-worker test`
3. `pnpm --filter @haimang/orchestrator-core-worker typecheck`
4. `pnpm --filter @haimang/orchestrator-core-worker test`
5. `pnpm --filter @haimang/agent-core-worker typecheck`
6. `pnpm --filter @haimang/agent-core-worker test`
7. `pnpm --filter @haimang/bash-core-worker test`
8. `pnpm --filter @haimang/context-core-worker test`
9. `pnpm --filter @haimang/filesystem-core-worker test`
10. `pnpm test:contracts`
11. `clients/web` typecheck 与 Mini Program JS syntax check

结果：**全部通过**。

### 4.2 Preview live smoke

```text
NANO_AGENT_LIVE_E2E=1 node --test \
  test/package-e2e/orchestrator-core/01-preview-probe.test.mjs \
  test/package-e2e/orchestrator-core/02-session-start.test.mjs \
  test/package-e2e/orchestrator-core/03-ws-attach.test.mjs \
  test/package-e2e/orchestrator-core/04-reconnect.test.mjs \
  test/package-e2e/orchestrator-core/05-verify-status-timeline.test.mjs \
  test/package-e2e/orchestrator-core/07-legacy-agent-retirement.test.mjs \
  test/cross-e2e/*.test.mjs
```

结果：`28 / 28 pass`。

这轮 live smoke 覆盖了：

1. preview probe / public façade / legacy retirement
2. session start / ws attach / reconnect / verify / timeline
3. bash-core happy-path / cancel / unknown-tool / policy-ask
4. full façade -> agent-core -> bash-core cross-worker roundtrip
5. 真实 Workers AI mainline 与新的 closeout anchor

### 4.3 Preview D1 SQL spot-check

本轮额外直接对 preview D1 执行 remote SQL：

1. `PRAGMA table_info(nano_usage_events);`
2. `SELECT ... FROM nano_usage_events WHERE usage_event_uuid='37bece21-987e-4f69-ad9b-5543f64c1359';`
3. `SELECT COUNT(*) ... FROM nano_users / nano_teams / nano_conversation_sessions / nano_usage_events;`

结果：

| 项目 | 结果 |
| --- | --- |
| `provider_key` 列 | 存在，`cid=10` |
| closeout anchor row | `usage_event_uuid=37bece21-987e-4f69-ad9b-5543f64c1359`，`provider_key=workers-ai` |
| `trace_uuid` | `213260f5-9ff9-4c41-b52f-f9ee11b1ce2e` |
| `session_uuid` | `3494d560-389d-44c1-8a96-ae57f8feea77` |
| `nano_users` | `69` |
| `nano_teams` | `69` |
| `nano_conversation_sessions` | `88` |
| `nano_usage_events` | `80` |

结构化证据锚点：

- `docs/eval/zero-to-real/evidence/z5-213260f5-9ff9-4c41-b52f-f9ee11b1ce2e.json`

---

## 5. 统一 residual register

| 优先级 | 条目 | 当前状态 | 说明 |
| --- | --- | --- | --- |
| 1 | dead `deploy-fill` enum/type cleanup | `deferred-next-phase` | public auth ingress 已不再 mint `deploy-fill`，但 downstream type acceptance 仍有 dead compatibility residue。 |
| 2 | DO websocket heartbeat platform alignment | `deferred-next-phase` | 当前 15s heartbeat 已工作，但仍是 attachment-lifetime timer，不是更 platform-fit 的 Alarm / safer lifecycle handling。 |
| 3 | `session.resume` body/wire 统一 | `deferred-next-phase` | 当前 replay 主要由 `last_seen_seq` query 发挥作用，`session.resume` body 仍应与 server wire 真正对齐。 |
| 4 | tool registry single source of truth | `deferred-next-phase` | `agent-core` 与 `bash-core` 仍是 name-level drift guard，不是 schema/description 级单一真相源。 |
| 5 | client package extraction / JS shim | `deferred-next-phase` | Web / Mini Program 当前使用 hand-written wire-compatible helper，后续应抽成共享 shim。 |
| 6 | manual browser / Mini Program evidence | `deferred-next-phase` | code-level baseline 已有，但真实 browser / 微信开发者工具 / 真机证据仍未建立。 |
| 7 | snapshot stream vs continuous push 决策 | `deferred-next-phase` | 当前 WS 更接近 replay/timeline snapshot，不是 token-level live push。 |
| 8 | quota typed team-missing hardening | `deferred-next-phase` | preview-only seed escape hatch 仍存在；production bootstrap/absence discipline 需继续收紧。 |

这些项现在都属于 **next-phase backlog**，而不是 zero-to-real blocker。

---

## 6. 对 final closure / handoff 的直接价值

1. final closure 现在可以引用真实的 closeout smoke 与 D1 SQL 证据，而不是只回述 Z4 首轮 live run。
2. next-phase 不需要重新判断 “系统到底有没有 first real run baseline”；它可以直接从 backlog priorities 开始。
3. zero-to-real 从现在起可以被视为 **closed historical phase**，而不是继续漂移中的 implementation stream。

---

## 7. 最终 verdict

**Z5 closed.**

这次最重要的变化不是再写一轮代码，而是把 zero-to-real 彻底压成了一个有边界的完成态：auth、tenant boundary、session truth、Workers AI runtime、quota、real-client baseline、live preview 证据、D1 anchor 与下一阶段 backlog 现在都已经进入统一真相层。manual client evidence、stream-plane 决策、tool/client registry hardening 仍然留在后续阶段，但它们不再阻塞 zero-to-real 的阶段性闭合。
