# Z3 Closure — Real Runtime and Quota

> 阶段: `zero-to-real / Z3`
> 状态: `closed`
> 作者: `GPT-5.4`
> 时间: `2026-04-25`
> 对应 action-plan: `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md`
> 直接解锁: `docs/action-plan/zero-to-real/Z4-real-clients-and-first-real-run.md`

---

## 1. 结论

Z3 已达到 action-plan 约定的关闭条件，并且是在 preview live 路径上把 **Workers AI mainline、quota dual gate、durable usage truth、以及 façade -> agent-core -> bash-core roundtrip** 一次性收口。

zero-to-real 现在不再只是“有 durable session baseline，但 runtime 仍可能是假执行”的过渡状态；它已经拥有一条真实可运行、可计量、可审计、可通过 preview live E2E 证明的 runtime 主链。

---

## 2. 实际交付

1. 新增 `workers/agent-core/src/host/runtime-mainline.ts`，把 Workers AI、quota authorizer、capability transport、cross-seam anchor 收束到统一 assembler。
2. `workers/agent-core/src/llm/gateway.ts` 已不再是 interface-only stub，而是变成真实 Workers AI gateway seam；`runtime-mainline.ts` 也改为通过该 seam 进入 provider path。
3. 已新增 `workers/agent-core/src/llm/adapters/deepseek/index.ts` skeleton，明确“存在但不争夺 mainline”的 provider posture。
4. `workers/agent-core/src/kernel/runner.ts` 已接入 `beforeLlmInvoke` / `afterLlmInvoke`，并把 provider/quota 失败收敛为 canonical `system.notify + complete_turn` 路径。
5. `workers/agent-core/src/host/orchestration.ts` 已从 kernel snapshot 驱动真实 step-loop 信号，不再硬编码 `hasMoreToolCalls=false / llmFinished=false`。
6. `workers/agent-core/src/host/do/nano-session-do.ts` 已在存在 `AI` binding 时启动真实 `KernelRunner`，并把 verify/live capability path 一起接到 quota preauth。
7. 新增 `workers/agent-core/src/host/quota/{authorizer,repository}.ts`，形成 llm/tool 共用的 quota owner；review follow-up 中又把 usage 写入收紧为单次 `db.batch()`，并移除了 `agent-core -> nano_session_activity_logs` 直写。
8. `workers/bash-core/src/worker-runtime.ts` 已加入 quota ticket second gate，要求 `request_id / quota_kind / tool_name` 与 planned capability 对齐。
9. Z3 运行在已存在的 Wave B hardened baseline（`002-session-truth-and-audit.sql` + `003-session-truth-hardening.sql`）之上。
10. 新增 `workers/orchestrator-core/migrations/004-usage-and-quota.sql`，落下：
   - `nano_quota_balances`
   - `nano_usage_events`
   - 配套索引
11. `workers/orchestrator-core/migrations/005-usage-events-provider-key.sql` 已补 `provider_key`，让 quota usage 保留 provider lineage。
12. `workers/agent-core/wrangler.jsonc` 已接入 `AI` / `NANO_AGENT_DB` / quota limit 真实 preview 契约，并把 preview team seed 收紧为显式 `NANO_AGENT_ALLOW_PREVIEW_TEAM_SEED=true`。
13. `test/shared/orchestrator-auth.mjs` 已修正为“真实 auth 优先，deploy-tenant mismatch 时 local JWT fallback”，避免 preview 单租户 posture 与 bootstrap random team 冲突。
14. Z3 review follow-up 中发现并修复了两个真实 live blocker：
     - `cancel` 在 session 已 settled 时错误 interrupt idle kernel，导致 façade `cancel` 返回 1101
     - quota writeback 依赖 deploy team row，但 preview shared D1 未预先 seed `TEAM_UUID`

---

## 3. 关键验证证据

### 3.1 本地验证

1. `pnpm --filter @haimang/bash-core-worker typecheck`
2. `pnpm --filter @haimang/bash-core-worker test`
3. `pnpm --filter @haimang/agent-core-worker typecheck`
4. `pnpm --filter @haimang/agent-core-worker build`
5. `pnpm --filter @haimang/agent-core-worker test`
6. `pnpm --filter @haimang/orchestrator-core-worker typecheck`
7. `pnpm --filter @haimang/orchestrator-core-worker test`
8. `pnpm test:contracts`
9. `pnpm test:e2e`
10. `pnpm test:cross`

其中 `agent-core` package test 已覆盖这轮 review absorption follow-up 的新增回归：

- `workers/agent-core/test/llm/gateway.test.ts`
- `workers/agent-core/test/host/runtime-mainline.test.ts`
- `workers/agent-core/test/host/quota/repository.test.ts`

### 3.2 Preview infra / migration evidence

1. `CI=1 npx wrangler d1 migrations apply NANO_AGENT_DB --config workers/orchestrator-core/wrangler.jsonc --env preview --remote`
2. `pnpm --filter @haimang/bash-core-worker deploy:preview`
3. `pnpm --filter @haimang/agent-core-worker deploy:preview`
4. preview `PASSWORD_SALT` 与 `JWT_SIGNING_KEY_v1` 已通过 Wrangler secrets 写入相关 worker

### 3.3 Live E2E evidence

1. `NANO_AGENT_LIVE_E2E=1 NANO_AGENT_ORCHESTRATOR_JWT_SECRET=<preview-key> pnpm test:package-e2e` → `36 / 36 pass`
2. `NANO_AGENT_LIVE_E2E=1 NANO_AGENT_ORCHESTRATOR_JWT_SECRET=<preview-key> pnpm test:cross-e2e` → `12 / 12 pass`

其中 live 证据覆盖的是 **preview deploy roundtrip 与 cross-worker runtime surface**；它不是 Z3 新代码正确性的唯一证明，后者同时依赖 §3.1 中新增的 package regressions。live 侧当前已经覆盖：

- `orchestrator-core` public start / verify / ws attach / reconnect / cancel / timeline / auth negatives
- `agent-core` preview probe 与 legacy retirement envelope
- `bash-core` happy path / cancel path / unknown-tool / policy-ask contract
- `orchestrator-core -> agent-core -> bash-core` 的 capability verify / mid-session cross-worker call / final façade roundtrip

---

## 4. Z3 exit criteria 对照

| Z3 目标 | 结果 |
| --- | --- |
| Workers AI 成为 real runtime mainline | ✅ |
| llm 与 tool 进入 shared quota law | ✅ |
| `nano_usage_events / nano_quota_balances` durable truth 落地 | ✅ |
| preview live path 可证实真实 capability roundtrip | ✅ |
| façade cancel / verify / cross-worker call 无 live blocker | ✅ |
| Z3 closure 文档存在 | ✅ |

---

## 5. 仍需诚实记录的 residuals

1. `orchestrator-auth` 真正 bootstrap 的 team UUID 仍然是随机值，而 preview deploy posture 仍是单租户固定 `TEAM_UUID`；当前 live harness 通过 JWT fallback 保持测试可运行，但 auth/bootstrap 与 deploy tenant 真正统一仍是后续工作。
2. quota activity 当前保守地只落到 session scope；`agent-core` 的 local kernel turn id 还不能直接充当 durable `nano_conversation_turns.turn_uuid`。若后续需要 turn-scoped quota lineage，必须先冻结跨 worker durable turn mapping。
3. quota repo 对缺失 deploy team row 的 synthetic seed 已收紧为 preview-only 显式 escape hatch：只有 `NANO_AGENT_ALLOW_PREVIEW_TEAM_SEED=true` 时才允许；production posture 仍应提供真实 team rows。
4. `agent-core` 现已停止直写 `nano_session_activity_logs`；若未来需要把 quota/runtime evidence 同步进 activity log，必须经由 `orchestrator-core` façade，而不是重新突破 write ownership。
5. Z3 本轮证明的是 Workers AI + quota + live roundtrip first-wave；更细粒度 billing/admin/product surfaces 仍明确 out-of-scope。

---

## 6. 对 Z4 的直接价值

1. Z4 可以直接建立在真实 preview runtime 上做 client first-real-run，而不需要再消费 mock loop。
2. Web / Mini Program 已可以读取真实 capability/error taxonomy，而不是开发期 invented envelopes。
3. runtime 失败与 quota 决策已经拥有 durable truth，可直接成为 client UX / retry / hint 的输入。

---

## 7. 最终 verdict

**Z3 closed.**

这次最关键的变化不是“又多接了一层 provider”，而是 nano-agent 第一次拥有了真正可运行的 runtime 主链：Workers AI 不再只是设计名词，quota 不再只是内存里的 if 分支，bash capability 也不再只是 isolated package smoke。Z4 现在可以基于真实 runtime、真实 usage truth、真实 cross-worker roundtrip 去做 client 侧 first real run。
