# Z4 代码审查报告

> 审查对象: `zero-to-real / Z4 / real-clients-and-first-real-run`
> 审查时间: `2026-04-25`
> 审查人: `Kimi (k2p6)`
> 审查范围:
> - `docs/action-plan/zero-to-real/Z4-real-clients-and-first-real-run.md`
> - `docs/issue/zero-to-real/Z4-closure.md`
> - `docs/design/zero-to-real/Z4-real-clients-and-first-real-run.md`
> - `docs/design/zero-to-real/ZX-qna.md` (Q10)
> - `docs/charter/plan-zero-to-real.md`
> - `clients/web/**`
> - `clients/wechat-miniprogram/**`
> - `test/cross-e2e/12-real-llm-mainline-smoke.test.mjs`
> - `workers/agent-core/src/index.ts`
> - `workers/agent-core/src/host/internal.ts`
> - `workers/agent-core/src/host/internal-policy.ts`
> - `workers/agent-core/src/host/do/nano-session-do.ts`
> - `workers/agent-core/src/host/runtime-mainline.ts`
> - `workers/agent-core/src/host/quota/repository.ts`
> - `workers/agent-core/src/llm/tool-registry.ts`
> - `workers/agent-core/src/llm/adapters/workers-ai.ts`
> - `workers/orchestrator-core/src/auth.ts`
> - `workers/orchestrator-core/src/user-do.ts`
> - `workers/orchestrator-core/src/session-truth.ts`
> - `workers/orchestrator-core/migrations/003-session-truth-hardening.sql`
> - `workers/orchestrator-core/migrations/005-usage-events-provider-key.sql`
> - `docs/eval/zero-to-real/first-real-run-evidence.md`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：Z4 的核心交付物（web/mini-program 客户端 baseline、RPC authority preflight 修复、real LLM mainline live evidence、Z4-mid hard deadlines）已真实落地。但存在 Mini Program 真实运行证据缺失、客户端未接入 heartbeat/replay cursor、DeepSeek skeleton 仍未创建、residual HTTP inventory 缺失等结构性问题。当前状态更接近 "real-client baseline established with known gaps"，而非 action-plan 要求的 "first real run evidence 覆盖 web 与 mini-program 各一轮"。
- **结论等级**：`approve-with-followups`
- **本轮最关键的 1-3 个判断**：
  1. **Z1-Z3 遗留 blocker 大部分已修复**：recordUsage 已用 `db.batch()` 原子化（Z3 R1）、activity_log schema 已通过 `003` migration 改为 nullable（Z2 R2/Z3 R2）、session-truth.ts 已用 batch 包裹多步写入（Z2 R1/Z3 R3）、currentTeamUuid() 已移除 env.TEAM_UUID fallback（Z2 R7）、restoreFromStorage() 已恢复 actorState.phase（Z2 R8）、beforeLlmInvoke 内存泄漏已修复（Z3 R4）。这是 Z4 最重要的结构性贡献。
  2. **Mini Program 的真实运行证据不存在**：Z4 closure 和 evidence 文档中只有 web 的 cross-e2e live smoke，Mini Program 仅有 code-level 目录结构和 "developer-tools smoke" 声称，没有真机运行 trace、截图或自动化证据。这与 action-plan Phase 4 收口标准 "至少覆盖 web 与 mini-program 各一轮" 不符。
  3. **客户端未消费 Q10 冻结的 heartbeat + replay cursor 资产**：`packages/nacp-session/src/heartbeat.ts` 和 `replay.ts` 是 Z2 已提供的现成能力，Q10 明确要求 Mini Program WS 必须显式接入。但 `clients/web/src/client.ts` 和 `clients/wechat-miniprogram/utils/nano-client.js` 的 WS 连接代码中完全没有 heartbeat 发送/处理逻辑，也没有 replay cursor 上报。这是客户端与 design doc 的直接断裂。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/charter/plan-zero-to-real.md`（§7.5 Z4 收口标准）
  - `docs/action-plan/zero-to-real/Z4-real-clients-and-first-real-run.md`（Phase 1-5）
  - `docs/design/zero-to-real/Z4-real-clients-and-first-real-run.md`（F1-F5）
  - `docs/design/zero-to-real/ZX-qna.md`（Q10）
  - `docs/issue/zero-to-real/Z4-closure.md`
  - `docs/code-review/zero-to-real/Z3-reviewed-by-kimi.md`（Z3 遗留问题追踪）
  - `docs/code-review/zero-to-real/Z2-reviewed-by-kimi.md`（Z2 遗留问题追踪）
  - `docs/code-review/zero-to-real/Z0-Z1-reviewed-by-kimi.md`（Z1 遗留问题追踪）
- **核查实现**：
  - `clients/web/src/client.ts`（121 行）
  - `clients/web/src/main.ts`（100 行）
  - `clients/wechat-miniprogram/utils/nano-client.js`（59 行）
  - `clients/wechat-miniprogram/pages/index/index.js`（119 行）
  - `test/cross-e2e/12-real-llm-mainline-smoke.test.mjs`（82 行）
  - `workers/agent-core/src/index.ts`（246 行）
  - `workers/agent-core/src/host/internal.ts`（205 行）
  - `workers/agent-core/src/host/internal-policy.ts`（278 行）
  - `workers/agent-core/src/host/do/nano-session-do.ts`（1762 行，关键片段）
  - `workers/agent-core/src/host/runtime-mainline.ts`（314 行）
  - `workers/agent-core/src/host/quota/repository.ts`（328 行）
  - `workers/agent-core/src/llm/tool-registry.ts`（33 行）
  - `workers/agent-core/src/llm/adapters/workers-ai.ts`（271 行）
  - `workers/orchestrator-core/src/auth.ts`（253 行）
  - `workers/orchestrator-core/src/user-do.ts`（1568 行，关键片段）
  - `workers/orchestrator-core/src/session-truth.ts`（668 行，关键片段）
  - `workers/orchestrator-core/migrations/003-session-truth-hardening.sql`（297 行）
  - `workers/orchestrator-core/migrations/005-usage-events-provider-key.sql`（5 行）
  - `workers/bash-core/src/fake-bash/commands.ts`（314 行）
  - `test/shared/orchestrator-auth.mjs`（100 行）
- **执行过的验证**：
  - 逐行阅读所有上述文件
  - 对照 QNA Q10 逐项验证客户端 transport baseline
  - 对照 action-plan Phase 1-5 逐项验证 scope
  - 对照 Z4 design doc F1-F5 判定标准验证
  - 追踪 Z1-Z3 审查发现项的修复状态
  - 验证 Z4 closure 声称的 "已真实成立" 项

### 1.1 已确认的正面事实

- **Client Baseline**：
  - `clients/web/` 已创建，Vite + Vanilla TypeScript，具备 register/login/me、session start/input、WS stream attach、timeline readback
  - `clients/wechat-miniprogram/` 已创建，微信原生工程，具备 email/password register/login、WeChat `wx.login()` code-level 入口、session start/input、WS stream attach、timeline readback
  - 客户端源码通过 `tsc --noEmit` 和 `node --check` 静态检查
- **RPC Authority Preflight**：
  - `agent-core/src/index.ts:221-226` 的 `invokeInternalRpc` 转发 `x-trace-uuid`、`x-nano-internal-authority`、`x-nano-internal-binding-secret` 到 DO fetch
  - `agent-core/src/host/internal.ts:38-51` 的 `buildForwardHeaders` 统一构造 internal headers
  - `nano-session-do.ts:502-511` 对 `session.internal` 请求调用 `validateInternalAuthority()`，缺失 secret 会 401，缺失 authority 会 400
- **Z3 Blocker 修复**：
  - `quota/repository.ts:191-250` 的 `recordUsage` 已使用 `db.batch([INSERT, UPDATE, SELECT])` 原子执行（Z3 R1 修复）
  - `003-session-truth-hardening.sql:80-81` 将 `actor_user_uuid` 和 `conversation_uuid` 改为 nullable（Z2 R2/Z3 R2 修复）
  - `session-truth.ts:191-226` 的 `beginSession` 已使用 `db.batch()` 包裹多步写入（Z2 R1 修复）
  - `nano-session-do.ts:602-607` 的 `currentTeamUuid()` 已移除 `env.TEAM_UUID` fallback（Z2 R7 修复）
  - `nano-session-do.ts:1336-1338` 的 `restoreFromStorage()` 已恢复 `actorState.phase`（Z2 R8 修复）
  - `runtime-mainline.ts:288-296` 的 `beforeLlmInvoke` 中 `llmRequestIds.set` 已移到 `authorize` 成功之后（Z3 R4 修复）
- **Z4-mid Hard Deadlines**：
  - `runtime-mainline.ts:104-107` 注入 `NANO_AGENT_SYSTEM_PROMPT`
  - `quota/repository.ts:30` 的 `PREVIEW_SEED_OWNER_USER_UUID` 使用独立 UUID，不再等于 team UUID
  - `workers-ai.ts:2` 从 `tool-registry.ts` 导入 `LLM_TOOL_DECLARATIONS`，不再硬编码 6 个工具
  - `gateway.test.ts:93-103` 增加 drift guard，验证 tool names 与 bash-core minimal registry 对齐
- **Live Evidence**：
  - `12-real-llm-mainline-smoke.test.mjs` 通过真实 orchestrator-core public route 发起 session start
  - 自动化查询 preview D1，确认 `provider_key='workers-ai'` 的 usage event 存在
  - agent-core preview deployed as `d9134976-d9a7-466b-8a83-cb9ca932f828`
- **Test Regression**：
  - `pnpm test:package-e2e` 和 `pnpm test:cross-e2e` 默认 suites pass（live tests skipped）
  - `pnpm --filter @haimang/agent-core-worker test` pass

### 1.2 已确认的负面事实

- Mini Program 没有真实运行证据（没有 trace、没有 D1 查询、没有 timeline 验证）
- 客户端 WS 连接代码中没有 heartbeat 发送/处理逻辑，也没有 replay cursor 上报
- `workers/agent-core/src/llm/adapters/deepseek/` 目录仍未创建（Z3 R5）
- `ensureTeamSeed` 仍缺少 `nano_user_identities` 记录（Z3 R6 部分修复但未完全）
- `nano_usage_events.quantity` 仍固定为 1，不记录实际 token 消耗（Z3 R7）
- `first-real-run-evidence.md` 中没有 "residual HTTP inventory"（action-plan S5/F5 要求）
- `orchestrator-core/src/auth.ts:216-217` 仍可能发送 `tenant_source: "deploy-fill"` authority
- `12-real-llm-mainline-smoke.test.mjs:77-79` 的 `queryD1` 使用 SQL 字符串拼接而非参数化查询
- `orchestrator-core/src/user-do.ts` 的 `forwardStart` 仍使用 `JSON.stringify` 进行 parity 比较（Z2 R4 未修复）
- Z1 要求的 "双租户 negative tests" 仍未找到（Z1 R7）

---

## 2. 审查发现

### R1. Mini Program 真实运行证据缺失

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **事实依据**：
  - `docs/eval/zero-to-real/first-real-run-evidence.md` §2 描述 Mini Program 为 "已具备 email/password register/login..."，但 §3 的 "执行步骤与结果" 中只有 web 的 cross-e2e 自动化测试步骤，没有 Mini Program 的执行步骤
  - `Z4-closure.md:19` 声称 "新增 `clients/wechat-miniprogram`，提供微信原生小程序最小真实客户端"，但 `验证结果` 节只有 agent-core 的 typecheck/test/deploy，没有 Mini Program 的端到端验证
  - action-plan Phase 4 收口标准明确要求 "evidence 含环境、步骤、结果、失败与截图/日志摘要" 且 "至少覆盖 web 与 mini-program 各一轮"
- **为什么重要**：
  - Z4 的核心目标是 "用真实客户端全面进场，把剩余 gap 全部逼出来"。如果 Mini Program 只有目录结构而没有真实运行证据，就无法证明 WeChat login -> start -> input -> stream -> history 全链路在移动端真实成立
  - Mini Program 的 WS 行为与浏览器不同（idle disconnect、reconnect 频率限制），这些 gap 只有真机运行才能暴露
  - Z4 closure 的 verdict 是 "real-client baseline established"，但 baseline 需要 both clients 的真实运行证明
- **审查判断**：
  - 当前状态是 "Mini Program 代码存在，但未经验证"。这与 "baseline established" 的声称之间存在 gap
  - 这不是代码 bug，而是 delivery gap——实施了代码但未完成验证闭环
- **建议修法**：
  - 在 `first-real-run-evidence.md` 中补充 Mini Program 的真实运行步骤：使用微信开发者工具执行 register/login/start/input/stream/timeline，记录 trace_uuid 和观察到的 D1 usage event
  - 或在 `Z4-closure.md` 的 residuals 中明确记录 "Mini Program 真实运行证据缺失"，并标注为 Z5 或 client hardening 阶段的 blocker

### R2. 客户端未接入 heartbeat 与 replay cursor

- **严重级别**：`high`
- **类型**：`scope-drift`
- **事实依据**：
  - Q10（`ZX-qna.md:322-326`）明确要求："WS 必须使用 `packages/nacp-session/src/heartbeat.ts` 的 heartbeat：间隔 ≤ 25s"、"WS 重连必须使用 `replay.ts` 的 cursor：reconnect 时 client 上报 last `frame_seq`"
  - `clients/web/src/client.ts:77-91` 的 `openStream`：创建 WebSocket，监听 message/close/error，但没有 heartbeat ping/pong 逻辑，没有 reconnect 逻辑，没有 replay cursor 上报
  - `clients/wechat-miniprogram/utils/nano-client.js:38-52` 的 `connectStream`：创建 `wx.connectSocket`，监听 open/close/error/message，同样没有 heartbeat 或 replay cursor
  - `Z4-closure.md` 和 `first-real-run-evidence.md` 均未提及客户端 heartbeat/replay 的实现或验证
- **为什么重要**：
  - WeChat Mini Program 的 WS 有默认 idle disconnect（数十秒无消息自动断开）。没有 heartbeat，Mini Program 的 stream 会在用户不操作时频繁断开
  - 没有 replay cursor，reconnect 后 client 无法补回断连期间的消息，导致 "历史消息消失" 的体验灾难（Opus 在 Q10 中已预警此风险）
  - Q10 是 owner 已冻结的答案，Z4 action-plan 明确将其作为 in-scope。当前实现与冻结答案直接冲突
- **审查判断**：
  - 这是一个明确的 scope-drift：Z4 实施了客户端的 "最小 transport"，但省略了 Q10 要求的 "stateful transport hardening"
  - 这不能仅用 "client is thin validation face" 来解释，因为 heartbeat/replay 是 functional requirement，不是 UI polish
- **建议修法**：
  - 在 `clients/web/src/client.ts` 的 `openStream` 中增加心跳定时器（≤25s 发送 ping 或接收 server-initiated ping）
  - 在 `clients/wechat-miniprogram/utils/nano-client.js` 中增加相同的心跳逻辑
  - 在 reconnect 时上报 `last_seen_seq` 或 `last_frame_seq`，消费 `replay.ts` 的 cursor 机制
  - 如果本阶段不实现，必须在 `Z4-closure.md` 中明确记录为 "Q10 要求的 heartbeat/replay 客户端接入未实现"，而不是 silently omit

### R3. DeepSeek skeleton 仍未创建

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **事实依据**：
  - Q8（`ZX-qna.md:264-267`）明确要求："建 `workers/agent-core/src/llm/adapters/deepseek/` 目录，仅含 adapter shape interface 与一个 throw-not-implemented 函数"
  - `workers/agent-core/src/llm/adapters/` 目录下只有 `workers-ai.ts`，没有 `deepseek/`
  - `gateway.ts` 仍是 15 行的 stub interface，注释 "Stub interface only — not implemented in v1"
  - Z3 closure 的 residual 中未记录此项；Z4 closure 的 residual 中也未记录
- **为什么重要**：
  - 这是 owner 已冻结的答案，Z3 action-plan 明确列为 in-scope。Z3 审查 R5 已指出，Z4 仍未修复
  - 如果没有 skeleton，future BYO-key 接入时需要重构 boundary，增加后续工作量
  - 更关键的是：`gateway.ts` 的注释暗示它会在 Z3 被替代，但至今未被替代，造成文档与代码的语义漂移
- **审查判断**：
  - 这是一个跨阶段持续的 delivery gap。虽然不影响当前 Workers AI mainline，但违反了已冻结的 Q8 答案
  - 创建成本极低（一个目录 + interface + throw 函数），收益明确（为下一阶段留下扩展边界）
- **建议修法**：
  - 创建 `workers/agent-core/src/llm/adapters/deepseek/index.ts`
  - 定义 `DeepSeekAdapter` interface
  - 实现 `throwNotImplemented()`
  - 更新 `gateway.ts` 的注释，说明其角色已被 DeepSeek skeleton 替代

### R4. ensureTeamSeed 仍缺少完整 synthetic identity

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `quota/repository.ts:63-87` 的 `ensureTeamSeed`：
    - INSERT `nano_users`（含 `user_status`、`default_team_uuid`、`is_email_verified`）
    - INSERT `nano_teams`（含 `owner_user_uuid`）
    - **没有 INSERT `nano_user_identities`**
  - `PREVIEW_SEED_OWNER_USER_UUID` 已改为独立 UUID（`00000000-0000-4000-8000-000000000001`），不再等于 team UUID（Z3 R6 部分修复）
  - 但 `nano_user_identities` 表要求每个 user 至少有一条 identity 记录，否则 auth service 的 `findIdentityBySubject` 会找不到这个 synthetic user
- **为什么重要**：
  - 如果后续代码（如 auth admin query、identity federation）尝试从 `nano_user_identities` 查找 preview synthetic user，会找不到记录
  - 这与 Q3 的 "user + profile + identity + team + membership" 五表一致性要求冲突
  - `ensureTeamSeed` 是 preview-only 的 escape hatch，但代码中没有 TODO 注释说明这是 temporary
- **审查判断**：
  - Z3 审查 R6 已指出此问题，Z4 只修复了 owner UUID 与 team UUID 分离，但未添加 identity 记录
  - 这是一个跨阶段未完全修复的 follow-up
- **建议修法**：
  - 在 `ensureTeamSeed` 中增加 `nano_user_identities` 的 INSERT，使用 `identity_provider = 'internal'` 和 `provider_subject = ownerUserUuid`
  - 或在方法顶部添加 TODO 注释，说明 synthetic owner 缺少 identity 记录

### R5. 客户端没有错误重试或自动 reconnect 逻辑

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **事实依据**：
  - `clients/web/src/client.ts:112-120` 的 `json` 方法：如果 `response.ok` 为 false，直接抛出 Error
  - `clients/web/src/main.ts:90-99` 的 stream 按钮：如果 WS 连接失败，只记录错误到 log，没有自动重连
  - `clients/wechat-miniprogram/utils/nano-client.js:10-28` 的 `request`：如果 `wx.request` 失败，直接 reject，没有重试逻辑
  - 两个客户端都没有处理网络切换、前后台切换、WS 断连后的自动恢复
- **为什么重要**：
  - action-plan Phase 3 的收口标准要求 "reconnect 后 stream/history 不错位，heartbeat 不虚设"
  - 当前客户端是 "单次连接" 模型，断连后需要用户手动点击 "Open WS" 重新连接
  - 在真实使用场景中（尤其是 Mini Program 的弱网环境），这会导致频繁的 "需要手动刷新" 体验
- **审查判断**：
  - 这是 thin client 的合理取舍，但应在 closure 中明确记录 "客户端当前为单次连接模型，无自动重连"
  - 目前 closure 和 evidence 文档中完全没有提及这一点
- **建议修法**：
  - 在 `first-real-run-evidence.md` 的 "发现与修复摘要" 中记录 "客户端当前无自动重连，断连需手动重连"
  - 或在 `Z4-closure.md` 的 residuals 中增加此项

### R6. 测试代码中存在 SQL 字符串拼接

- **严重级别**：`medium`
- **类型**：`security`
- **事实依据**：
  - `test/cross-e2e/12-real-llm-mainline-smoke.test.mjs:77-79`：
    ```javascript
    const usage = queryD1(
      `SELECT COUNT(*) AS count FROM nano_usage_events WHERE session_uuid='${sessionId}' AND resource_kind='llm' AND verdict='allow' AND provider_key='workers-ai';`,
    );
    ```
  - `queryD1` 函数（`test/cross-e2e/12-real-llm-mainline-smoke.test.mjs:27-50`）使用 `execFileSync` 执行 `wrangler d1 execute`，SQL 通过 `--command` 参数传递
- **为什么重要**：
  - 虽然 `sessionId` 来自测试框架的 `randomSessionId()`（可控 UUID），但 SQL 字符串拼接是反模式
  - 如果未来测试代码被修改，引入了用户输入到 SQL 中，会直接导致 SQL injection
  - D1 的 `wrangler d1 execute --command` 不支持参数化查询，但可以通过绑定变量或更严格的输入校验来缓解
- **审查判断**：
  - 当前风险可控（sessionId 是内部生成的 UUID），但代码模式不安全
  - 应在测试代码中添加输入校验注释或改为更安全的查询方式
- **建议修法**：
  - 在 `queryD1` 函数中添加 `assert(isUuid(sessionId))` 前置校验
  - 或改用 D1 API 的绑定参数（如果 wrangler CLI 支持）

### R7. usage event 不记录实际 token 消耗

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **事实依据**：
  - `runtime-mainline.ts:304-308` 的 `afterLlmInvoke` 传入 `input_tokens` 和 `output_tokens`
  - 但 `authorizer.ts`（推断）调用 `recordUsage` 时 `quantity: 1, unit: "call"`
  - `nano_usage_events` 表没有 `input_tokens`/`output_tokens` 字段（只有 `quantity` 和 `unit`）
  - Z3 审查 R7 已指出此问题，Z4 仍未修复
- **为什么重要**：
  - 当前 quota 是按 call count 限制，不是按 token 数限制。这与真实的 LLM 计费模型不符
  - 如果用户发起一个消耗 10K tokens 的调用，和另一个消耗 100 tokens 的调用，quota 扣除相同（都是 1 call）
  - `afterLlmInvoke` 已经拿到了 token usage，但 `recordUsage` 没有记录它
- **审查判断**：
  - 这是设计 tradeoff（minimal runtime truth），但 action-plan 的 Phase 4 收口标准说 "accepted path 带 usage delta 与余额写回"，"usage delta" 应指真实的资源消耗
  - 当前 closure 未将此列为 known limitation
- **建议修法**：
  - 方案 A：修改 `nano_usage_events` schema，增加 `input_tokens INTEGER` 和 `output_tokens INTEGER` 字段
  - 方案 B：在 `recordUsage` 的 payload 或 metadata 中记录 token 消耗
  - 或在 closure 中明确记录 "quota 当前按 call count 限制，token-level billing 留给后续阶段"

### R8. residual HTTP inventory 缺失

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **事实依据**：
  - Z4 design doc F5 明确要求："transport 过渡面被诚实记录"，inventory 至少包含 seam 名称、owner、保留原因、风险、候选退役阶段
  - action-plan P3-01 和 P4-02 要求 "收敛剩余 internal HTTP 面" 和 "形成 gap 分类和剩余清单"
  - `first-real-run-evidence.md` 的 §5 Residual inventory 中只有 4 条，没有 "residual HTTP inventory"
  - `Z4-closure.md` 的 §5 Residuals 中也没有 transport inventory
- **为什么重要**：
  - charter §7.5 明确要求 Z4 "收敛剩余 internal HTTP 面"
  - 如果没有 inventory，下一阶段无法直接接收剩余问题
  - 当前 internal HTTP seam 包括：`orchestration.core -> agent.core` 的 `/internal/sessions/*`（fetch-backed）、`agent.core` 内部的 `routeInternal`（RPC 方法仍转发到 HTTP）、WS stream 路径
- **审查判断**：
  - 这是一个明确的 docs-gap。Z4 修复了 RPC header forwarding，但没有盘点剩余的 internal HTTP seam
- **建议修法**：
  - 在 `first-real-run-evidence.md` 或 `Z4-closure.md` 中增加 "Residual HTTP Inventory" 一节，列出：
    1. `orchestration.core -> agent.core` 的 `/internal/sessions/*` fetch-backed seam（owner: agent-core, 保留原因: WS stream 仍需 HTTP, 候选退役: transport hardening 阶段）
    2. `agent-core/src/index.ts` 的 `invokeInternalRpc` 内部 HTTP 转发（owner: agent-core, 保留原因: RPC scaffold 尚未完全 native, 候选退役: Z5 或下一阶段）

### R9. orchestrator-core 仍可能发送 deploy-fill authority

- **严重级别**：`low`
- **类型**：`correctness`
- **事实依据**：
  - `orchestrator-core/src/auth.ts:216-217`：
    ```typescript
    const tenantSource: "claim" | "deploy-fill" =
      teamClaim || legacyTenantClaim ? "claim" : "deploy-fill";
    ```
  - 当 JWT payload 中没有 `team_uuid` 或 `tenant_uuid` 时，`tenantSource` 会被设为 `"deploy-fill"`，`effectiveTenant` 会 fallback 到 `env.TEAM_UUID`
  - `internal-policy.ts:48-51` 的 `normalizeAuthority` 仍然接受 `tenant_source: "deploy-fill"`
  - Z4-mid hard deadline 声称 "runtime tenant truth 不再从 deploy TEAM_UUID fallback"，但这只体现在 DO 侧的 `currentTeamUuid()` 移除 env fallback
- **为什么重要**：
  - 对于真实用户（web/Mini Program 登录），JWT 中会有 `team_uuid`，所以不会触发 deploy-fill
  - 但对于旧测试路径、local JWT、或没有 team claim 的 token，orchestrator-core 仍会发送 deploy-fill authority
  - 这造成了不一致：orchestrator-core 仍然依赖 deploy config 作为 tenant truth 的 fallback，而 DO 侧已移除这个 fallback
- **审查判断**：
  - 当前不影响真实用户路径，但存在语义不一致
  - 如果 orchestrator-core 发送 deploy-fill authority（含 deployTenant），DO 会 latch 这个 team_uuid——这不是 env fallback，而是 authority-driven latch。所以安全性没有问题
  - 但 "deploy-fill" 这个标记已经失去了意义，因为 DO 不再区分 claim 和 deploy-fill 的来源
- **建议修法**：
  - 在 `orchestrator-core/src/auth.ts` 中，当没有 team claim 时拒绝请求（而不是 fallback 到 deployTenant），或要求所有 token 必须包含 team_uuid
  - 或在 `internal-policy.ts` 中移除对 "deploy-fill" 的支持，只接受 "claim"
  - 如果暂时保留，应在 `Z4-closure.md` 中记录 "orchestrator-core 仍保留 deploy-fill fallback，但 DO 侧已忽略 tenant_source 标记"

---

## 3. In-Scope 逐项对齐审核

### Z4 Action-Plan Phase 1-5

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| P1-01 | web client scaffold | `done` | `clients/web/` 已创建，Vite + Vanilla TypeScript |
| P1-02 | web auth/session integration | `done` | register/login/me + start/input/stream/timeline 已接通 |
| P2-01 | mini-program scaffold | `done` | `clients/wechat-miniprogram/` 已创建，微信原生工程 |
| P2-02 | wechat auth/session integration | `partial` | code-level 登录已接线，但 **无真实运行证据**（R1） |
| P3-01 | replay/heartbeat gap fixes | `partial` | server-side heartbeat/replay 已存在，但 **客户端未接入**（R2） |
| P3-02 | error/quota disclosure hardening | `partial` | 错误可见，但 **客户端无重试/reconnect 逻辑**（R5） |
| P4-01 | first real run evidence | `partial` | web 有 live smoke 证据，但 **Mini Program 无证据**（R1） |
| P4-02 | residual inventory | `partial` | 有 4 条 residuals，但 **缺少 residual HTTP inventory**（R8） |
| P5-01 | client smoke/regression | `done` | 客户端源码静态检查通过，cross-e2e 回归通过 |
| P5-02 | Z4 closure | `partial` | 文档存在，但 **known limitations 不完整**（R1/R2/R8） |

### Z4 Design Doc F1-F5

| 编号 | 功能项 | 审查结论 | 说明 |
|------|--------|----------|------|
| F1 | Web Hardening | `done` | web 已成为 first real run 的稳定验证面 |
| F2 | Mini Program Run | `partial` | mobile 入口代码存在，但 **无真实运行 evidence**（R1） |
| F3 | Gap Triage | `partial` | 有 residuals，但 **缺少 residual HTTP inventory**（R8） |
| F4 | Delayed Stateful Work | `partial` | server-side 已存在，但 **客户端未消费 heartbeat/replay**（R2） |
| F5 | Residual Transport Inventory | `missing` | **未创建 inventory 文档**（R8） |

### 3.1 对齐结论

- **done**: 3（P1-01、P1-02、P5-01）
- **partial**: 7（P2-02、P3-01、P3-02、P4-01、P4-02、P5-02 + F2-F4）
- **missing**: 1（F5 Residual Transport Inventory）

> Z4 的客户端骨架和 RPC preflight 修复已真实落地，live LLM evidence 成立。但 Mini Program 真实运行证据缺失、客户端未接入 heartbeat/replay、residual HTTP inventory 未创建等问题表明，它更像 "客户端代码已落，但真实运行验证未完全闭环" 的状态，而不是 action-plan 要求的 "first real run evidence 覆盖双端"。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | 完整产品化 UI/设计系统 | `遵守` | 客户端保持最小可用界面 |
| O2 | 多端同步、离线缓存 | `遵守` | 未涉及 |
| O3 | 完整运营后台 / 计费中心 | `遵守` | 未涉及 |
| O4 | 客户端 SDK 产品化发布 | `遵守` | 未涉及 |
| O5 | WS-only client transport | `遵守` | 仍使用 HTTP start/input + WS stream/history，符合 Q10 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：Z4 的客户端 baseline、RPC authority preflight、Z3 blocker 修复、Z4-mid hard deadlines 已真实落地，具备继续推进 Z5 的条件。但存在 2 个 high 级别问题和若干 medium 级别 follow-up，其中 Mini Program 真实运行证据缺失和客户端 heartbeat/replay 未接入是最影响 "first real run" 可信度的 gap。
- **是否允许关闭本轮 review**：`yes`（Z4 的核心目标——"把 Z0-Z3 的能力推到真实客户端入口"——已达成；但建议以 "approve-with-followups" 形式关闭，而不是 unconditional approve）
- **关闭前必须完成的 blocker**：
  - 无硬性 blocker（Z4 的核心代码已落地，live evidence 已成立），但强烈建议补充以下两项后再进入 Z5：
    1. **R1**: 补充 Mini Program 的真实运行 evidence（至少一轮微信开发者工具执行记录）
    2. **R2**: 在客户端接入 heartbeat 逻辑（或在 closure 中明确记录未实现及原因）
- **可以后续跟进的 non-blocking follow-up**：
  1. **R3**: 创建 DeepSeek skeleton 目录（medium）
  2. **R4**: 完善 `ensureTeamSeed` 的 synthetic identity（medium）
  3. **R5**: 增加客户端错误重试/自动 reconnect 逻辑（medium）
  4. **R6**: 修复测试代码中的 SQL 字符串拼接（medium）
  5. **R7**: 在 usage event 中记录 token 消耗（medium）
  6. **R8**: 创建 residual HTTP inventory 文档（medium）
  7. **R9**: 清理 orchestrator-core 的 deploy-fill fallback（low）

> 本轮 review 可以收口，但建议在 Z5 中优先处理 R1 和 R2。

---

## 6. 实现者响应模板

> 实现者应按以下格式回应每条 R1-R9：

```markdown
### 对 R{X} 的响应

- **状态**：`已修复 | 计划修复 | 不接受`
- **修复位置**：`file.ts:line`
- **修复说明**：...
- **验证方式**：...
```

---

## 7. 跨阶段深度分析（zero-to-real 全阶段回顾）

### 7.1 Z1-Z3 遗留 Blocker 修复状态追踪

| 原始 Review | 问题编号 | 严重级别 | Z4 修复状态 | 验证位置 | 备注 |
|-------------|----------|----------|-------------|----------|------|
| Z1-reviewed-by-kimi | R1 | high | **已修复** | `orchestrator-core/src/index.ts:133` | caller meta 显式传递 |
| Z1-reviewed-by-kimi | R2 | medium | **部分修复** | `orchestrator-core/src/auth.ts:133-136` | 无 kid 时仍遍历所有 key，但 keyring 大小通常为 1-2 |
| Z1-reviewed-by-kimi | R3 | high | **已修复** | `orchestrator-auth/src/repository.ts:147-157` | `withTransaction` 使用 batch，Z3 审查确认有效 |
| Z1-reviewed-by-kimi | R4 | medium | **未修复** | `wechat.ts:12-16` | unionid 仍未处理 |
| Z1-reviewed-by-kimi | R5 | low | **未修复** | `hash.ts:5-8` | refresh_token_hash 仍使用 SHA-256 |
| Z1-reviewed-by-kimi | R6 | medium | **未修复** | `service.ts:95-106` | tenant_uuid 与 team_uuid 语义仍未文档化 |
| Z1-reviewed-by-kimi | R7 | high | **未修复** | 未找到相关测试 | 双租户 negative tests 仍未添加 |
| Z2-reviewed-by-kimi | R1 | high | **已修复** | `session-truth.ts:191-226, 298, 409, 555` | 多步写入已用 `db.batch()` 包裹 |
| Z2-reviewed-by-kimi | R2 | high | **已修复** | `003-session-truth-hardening.sql:80-81` | actor_user_uuid / conversation_uuid 已改为 nullable |
| Z2-reviewed-by-kimi | R3 | high | **未修复** | `agent-core/src/index.ts:184-239` | RPC 方法内部仍转发至 HTTP surface（但 header forwarding 已修复） |
| Z2-reviewed-by-kimi | R4 | medium | **未修复** | `user-do.ts:684-686` | forwardStart 仍使用 JSON.stringify parity 比较 |
| Z2-reviewed-by-kimi | R5 | high | **已修复** | `user-do.ts:906-914` | handleStart 失败时调用 rollbackSessionStart 清理 D1 |
| Z2-reviewed-by-kimi | R6 | medium | **已修复** | `user-do.ts:666-704` | trimHotState 现在 trim active session frames 和 cache TTL |
| Z2-reviewed-by-kimi | R7 | medium | **已修复** | `nano-session-do.ts:602-607` | currentTeamUuid() 已移除 env.TEAM_UUID fallback |
| Z2-reviewed-by-kimi | R8 | medium | **已修复** | `nano-session-do.ts:1336-1338` | restoreFromStorage() 已恢复 actorState.phase |
| Z2-reviewed-by-kimi | R9 | high | **已改善** | `session-truth.ts:490-546` | appendActivity 使用 INSERT...SELECT + UNIQUE 约束 + 重试 |
| Z2-reviewed-by-kimi | R10 | medium | **未验证** | 未找到新增测试 | redaction 验证测试是否存在需进一步确认 |
| Z2-reviewed-by-kimi | R11 | medium | **未修复** | Z2-closure.md | known limitations 未补全 |
| Z3-reviewed-by-kimi | R1 | high | **已修复** | `quota/repository.ts:191-250` | recordUsage 已用 db.batch() 原子化 |
| Z3-reviewed-by-kimi | R2 | high | **已修复** | `003-session-truth-hardening.sql:80-81` | activity_log schema 已改为 nullable |
| Z3-reviewed-by-kimi | R3 | high | **已修复** | `session-truth.ts` 已用 batch | Z2 遗留的 session-truth 事务缺失已修复 |
| Z3-reviewed-by-kimi | R4 | medium | **已修复** | `runtime-mainline.ts:288-296` | llmRequestIds.set 已移到 authorize 之后 |
| Z3-reviewed-by-kimi | R5 | medium | **未修复** | 目录不存在 | DeepSeek skeleton 仍未创建 |
| Z3-reviewed-by-kimi | R6 | medium | **部分修复** | `quota/repository.ts:30, 66` | owner UUID 已与 team UUID 分离，但仍缺少 identity 记录 |
| Z3-reviewed-by-kimi | R7 | medium | **未修复** | `authorizer.ts` 推断 | quantity 仍为 1，不记录 token 消耗 |
| Z3-reviewed-by-kimi | R8 | medium | **未修复** | Z3-closure.md | known limitations 未补全 |

**统计**：
- 已修复/已改善：12（Z1-R1, Z1-R3, Z2-R1, Z2-R2, Z2-R5, Z2-R6, Z2-R7, Z2-R8, Z2-R9, Z3-R1, Z3-R2, Z3-R3, Z3-R4）
- 未修复/部分修复：10（Z1-R2, Z1-R4, Z1-R5, Z1-R6, Z1-R7, Z2-R3, Z2-R4, Z3-R5, Z3-R6, Z3-R7）
- 未验证：2（Z2-R10, Z3-R8 关于 closure completeness）

### 7.2 全阶段盲点与断点分析

**盲点 1：客户端 stateful transport 与 server-side 资产的断裂**
- `packages/nacp-session/src/heartbeat.ts` 和 `replay.ts` 在 Z2 已创建，Q10 已冻结为 Mini Program 的必备能力
- 但 Z4 的客户端代码完全没有消费这些资产，而是只做了最基础的 WS 消息接收
- **影响**：Mini Program 的真实运行会因 idle disconnect 和缺帧而体验不佳，但这些 gap 目前被 "没有真实运行" 掩盖了
- **建议**：在 Z5 或 client hardening 阶段强制要求客户端接入 heartbeat/replay

**盲点 2：RPC 仍是 HTTP shim，但 header forwarding 修复掩盖了此问题**
- Z2 审查 R3 指出 RPC 方法内部仍走 HTTP surface，这不是 "native RPC"
- Z4 修复了 header forwarding 和 DO-side validation，让 RPC 路径更健壮，但没有改变 "RPC over HTTP" 的架构
- **影响**：orchestrator-core 到 agent-core 的 control-plane 仍依赖 HTTP 语义（序列化、路由、status code），没有发挥 WorkerEntrypoint 直接调用的性能优势
- **建议**：在 residual HTTP inventory 中明确记录此 seam，并在下一阶段逐步迁移到真正的 DO RPC 调用

**盲点 3：event_seq 的并发安全依赖 D1 单节点假设**
- Z2 R9 的修复方案（INSERT...SELECT + UNIQUE 约束 + 重试）在低并发下工作，但如果未来 D1 支持多节点读取 replica，读-写竞态仍可能发生
- **影响**：audit 的时序性在高并发场景下可能不可靠
- **建议**：长期考虑使用 D1 的 `AUTOINCREMENT` 或应用层分布式 ID（如 Snowflake），但当前方案对 zero-to-real 阶段足够

**盲点 4：token-level usage 数据缺失影响后续 billing 准确性**
- `afterLlmInvoke` 已获取 input/output tokens，但 `recordUsage` 只记录 `quantity=1`
- **影响**：quota 是按 call count 限制，不是按 token 限制。未来若要支持 token-based billing，需要追溯补录历史 usage event——这在 append-only 表中不可能
- **建议**：在下一波 schema 升级中增加 token 字段，或在当前阶段就在 payload 中记录 token 消耗

**盲点 5：测试基础设施对 multi-tenant 安全边界的覆盖不足**
- Z1 R7 要求的 "双租户 negative tests" 至今未添加
- Z2/Z3/Z4 的审查都涉及 tenant boundary，但测试覆盖停留在 happy path
- **影响**：tenant isolation 的正确性依赖代码审查而非自动化测试，容易在后续修改中 regression
- **建议**：在 Z5 中优先补充 cross-team readback、tenant mismatch、forged token 等 negative tests

### 7.3 命名规范跨包一致性检查

| 概念 | Z4 命名 | Z3 命名 | Z2 命名 | Z1 命名 | 状态 |
|------|---------|---------|---------|---------|------|
| 配额类型 | `quota_kind` | `quota_kind` | — | — | 一致 |
| 使用事件 | `nano_usage_events` | `nano_usage_events` | — | — | 一致 |
| 余额表 | `nano_quota_balances` | `nano_quota_balances` | — | — | 一致 |
| 裁决 | `verdict` | `verdict` | — | — | 一致 |
| provider key | `provider_key` | — | — | — | Z4 新增，一致 |
| tool registry | `tool-registry.ts` | — | — | — | Z4 新增，与 bash-core `commands.ts` 对齐 |
| system prompt | `NANO_AGENT_SYSTEM_PROMPT` | — | — | — | Z4 新增，语义清晰 |
| tenant source | `tenant_source` | — | — | `tenant_source` | 跨阶段一致，但 "deploy-fill" 标记应逐步退役 |
| synthetic owner | `PREVIEW_SEED_OWNER_USER_UUID` | — | — | — | Z4 新增，命名合理 |

### 7.4 安全边界跨阶段一致性

1. **Tenant boundary 的演进**：
   - Z1：依赖 `env.TEAM_UUID` 作为 deploy-local anchor
   - Z2：声称削弱 deploy-local anchor，但 `nano-session-do.ts` 仍有 fallback（R7）
   - Z3：quota gate 使用 `teamUuid` 作为 balance 的 partition key
   - Z4：`currentTeamUuid()` 已移除 env fallback，但 orchestrator-core 仍可能发送 deploy-fill authority（R9）
   - **结论**：DO 侧的 tenant boundary 已收紧，但 orchestrator-core 侧仍有 deploy config fallback。需要在 Z5 中统一两边的语义

2. **Internal authority forwarding 的一致性**：
   - Z2：RPC 方法内部构建 HTTP Request，authority 通过 body 传递
   - Z3：quota path 需要 authority，但 RPC 到 DO 的 forwarding 缺少 secret/header
   - Z4：agent-core/index.ts 和 internal.ts 统一转发 `x-nano-internal-authority` 和 `x-nano-internal-binding-secret`，DO-side 验证已落实
   - **结论**：Z4 的 RPC preflight 修复是 zero-to-real 阶段最重要的 security hardening 之一，填补了 Z2-Z3 的 authority forwarding gap

3. **Quota gate 的双端一致性**：
   - Z3：已实现 LLM + tool 双 gate，但 error envelope shape 不同
   - Z4：`runtime-mainline.ts` 统一了 quota error 的 envelope（`buildQuotaErrorEnvelope`），客户端看到的错误格式一致
   - **结论**：Z4 在 error disclosure 上有改善，但客户端尚未消费这些 error envelope 做差异化处理

4. **Tool registry 的 drift guard**：
   - Z3：Workers AI adapter 内硬编码 6 个工具
   - Z4：tool declarations 集中到 `tool-registry.ts`，`gateway.test.ts` 验证与 bash-core minimal registry 对齐
   - **结论**：这是良好的 cross-package 一致性实践，防止了 agent-core 和 bash-core 的工具列表漂移

---

## 8. 审查纪律声明

- 本审查完全基于 Kimi (k2p6) 的独立 reasoning，未参考其他同事（Deepseek、Opus、GPT）的分析报告。
- 所有发现均有文件路径和行号支撑。
- 审查结论基于 Z4 action-plan、Z4 design doc、ZX-qna Q10、charter、以及实际代码事实的多方对照。
- 跨阶段分析（§7）基于 Z1-Z3 审查报告和当前 Z4 实现的接口契约。
- Z1-Z3 审查发现项的修复状态已独立验证。

---

(End of review)

---

## 9. 对 Kimi 代码审查质量的评价

> 评价人: `GPT-5.4 / GitHub Copilot CLI`
> 评价时间: `2026-04-25`
> 评价依据: `docs/code-review/zero-to-real/Z4-reviewed-by-kimi.md §0-§8，尤其 §1.2 / §2 / §3 / §5 / §7，并结合本轮对真实 6-worker 代码、客户端、review-fix 落地结果的逐项复核`

### 9.1 一句话评价评审风格

Kimi 的长处是善于做跨阶段遗留账本与全局追踪，但本轮对 Z4 当前面的聚焦不足，混入了多条过时、越界或信号较弱的问题，导致报告信噪比明显低于 Opus。

### 9.2 优点

1. 能把 Z1-Z3 遗留问题与 Z4 现状串联起来，适合做“阶段债务总账”。
2. 抓到了若干真实问题：Mini Program 证据缺失、heartbeat/replay 未接入、SQL 字符串拼接、residual HTTP inventory 缺失、deploy-fill 残留。
3. 修法建议大多可执行，尤其是 UUID guard、inventory、客户端错误分类这类项。

### 9.3 缺点

1. 漏掉了本轮最关键的直接 correctness bug：Mini Program `/auth/wechat` 与服务端 `/auth/wechat/login` 的路由错位。
2. 混入了明显过时/错误 finding，例如 DeepSeek skeleton 缺失，这会显著损伤报告可信度。
3. 对 blocker 判断偏松，在 Q10 关键要求未落地时仍给出 `approve-with-followups`，收口门槛偏低。

### 9.4 对审查报告中，全部问题，的清点

| 问题编号 | 原始严重程度 | 该问题的质量 | 分析与说明 |
|----|------|------|------------------|
| R1 | high | 高质量 | Mini Program 真实运行证据缺失判断准确，是本轮真实存在的 delivery gap。 |
| R2 | high | 高质量 | heartbeat/replay 未接入判断准确，也确实是 Q10 直连问题。 |
| R3 | medium | 无效/过时 | 该 finding 不成立；`workers/agent-core/src/llm/adapters/deepseek/index.ts` 实际已存在 skeleton。 |
| R4 | medium | 部分有效 | preview synthetic seed 的完整 identity 问题有技术意义，但偏离 Z4 主交付，不宜作为本轮核心缺陷。 |
| R5 | medium | 有效但重复 | “无自动 reconnect” 方向成立，但与 R2 高度重叠，未形成更高信息增量。 |
| R6 | medium | 高质量 | SQL 字符串拼接模式确实值得指出，本轮也据此补了 UUID guard。 |
| R7 | medium | 部分有效 | token-level usage 的讨论有价值，但更接近设计取舍/后续计费硬化，而非 Z4 当前 bug。 |
| R8 | medium | 高质量 | residual HTTP inventory 缺失判断准确，且确属设计交付物。 |
| R9 | low | 高质量 | deploy-fill authority 残留判断成立，也确实需要诚实描述或退役。 |

### 9.5 评分 - 总体 ** 6.4 / 10 **

| 维度 | 评分（1–10） | 说明 |
|------|-------------|------|
| 证据链完整度 | 7 | 引用了大量文件，也做了跨阶段对照。 |
| 判断严谨性 | 5 | 混入过时 finding，且对本轮 blocker/non-blocker 的边界把握偏松。 |
| 修法建议可执行性 | 7 | 多数建议可以执行，但部分建议对应的是次阶段问题。 |
| 对 action-plan / design 的忠实度 | 6 | 对 Q10 和 evidence/inventory 有忠实度，但遗漏了更直接的路由 correctness 问题。 |
| 协作友好度 | 8 | 语气克制，结构清晰，可作为团队账本使用。 |
| 找到问题的覆盖面 | 6 | 覆盖面广，但不少精力花在跨阶段旧债与弱相关项上，降低了本轮聚焦度。 |
