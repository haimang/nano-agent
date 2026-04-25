# Z4 First Real Run Evidence

> 服务业务簇: `zero-to-real / Z4`
> 证据对象: `real clients + real Workers AI mainline + quota evidence`
> 当前状态: `executed + review-fixed`

---

## 1. 环境与版本

- **仓库 commit**: `1452db9`
- **Cloudflare 环境**: `preview`
- **orchestrator-core URL**: `https://nano-agent-orchestrator-core-preview.haimang.workers.dev`
- **agent-core URL**: `https://nano-agent-agent-core-preview.haimang.workers.dev`
- **agent-core preview version**: `d9134976-d9a7-466b-8a83-cb9ca932f828`
- **orchestrator-core preview version after review fix**: `8e08094d-50d1-4672-bf8d-3b3429a566fa`
- **D1**: `NANO_AGENT_DB / nano-agent-preview`
- **005 migration evidence**: remote `PRAGMA table_info(nano_usage_events)` 已确认 `provider_key` 列存在。

---

## 1.1 结构化证据锚点

| 字段 | 值 |
|------|----|
| `evidence_artifact` | `docs/eval/zero-to-real/evidence/z4-254c1dc7-c595-4e14-97cd-7435b008d33c.json` |
| `client_kind` | `cross-e2e-fetch` |
| `auth_path` | `orchestrator-auth register/login via orchestrator-core facade` |
| `transport_baseline` | `HTTP start + HTTP timeline readback; WS stream not exercised by this artifact` |
| `trace_uuid` | `254c1dc7-c595-4e14-97cd-7435b008d33c` |
| `session_uuid` | `5436ded3-4f5c-4485-b444-088b85633d0b` |
| `usage_event_uuid` | `965cd26e-9a6f-408e-a2b8-9f37cd17a44d` |
| `provider_key` | `workers-ai` |
| `runtime_ok` | `true` |
| `history_ok` | `true` |
| `reconnect_ok` | `not exercised by this artifact` |
| `closure_verdict` | `accepted-as-live-runtime-evidence-not-manual-client-evidence` |

---

## 2. 本轮真实运行覆盖面

1. **Web client baseline**
   - 新增 `clients/web`。
   - 使用 `Vite + Vanilla TypeScript`。
    - 已具备 register/login/me、session start、follow-up input、WS stream attach、timeline readback。
    - review-fix 后新增 `VITE_NANO_BASE_URL` 覆盖、`last_seen_seq` attach、`session.resume`、`session.heartbeat` 与 `session.stream.ack` 兼容 wire message。
    - UI 明确暴露 JSON event log，便于真实用户侧调试。

2. **WeChat Mini Program baseline**
   - 新增 `clients/wechat-miniprogram`。
   - 使用微信原生小程序工程结构。
    - 已具备 email/password register/login、WeChat `wx.login()` code-level login 入口、session start/input、WS stream attach、timeline readback。
    - review-fix 后修正 WeChat 路径为 `/auth/wechat/login`，并新增 `last_seen_seq` attach、`session.resume`、`session.heartbeat` 与 `session.stream.ack` 兼容 wire message。
    - 小程序端将错误直接写入页面 event log，避免 silent fail。

3. **Live LLM/quota evidence**
   - 新增 `test/cross-e2e/12-real-llm-mainline-smoke.test.mjs`。
   - live run 使用真实 orchestrator-core public session route 发起 session start。
   - agent-core preview 真实调用 Workers AI mainline。
   - 自动化查询 preview D1，确认同一 `session_uuid` 写入 `nano_usage_events(resource_kind='llm', verdict='allow', provider_key='workers-ai')`。

---

## 3. 执行步骤与结果

| 步骤 | 操作 | 结果 |
|------|------|------|
| 1 | `npx wrangler d1 migrations apply NANO_AGENT_DB --config workers/orchestrator-core/wrangler.jsonc --env preview --remote` | `005-usage-events-provider-key.sql` remote applied |
| 2 | `npx wrangler d1 execute ... "PRAGMA table_info(nano_usage_events);"` | `provider_key` 出现在 cid `10` |
| 3 | `pnpm --filter @haimang/agent-core-worker deploy:preview` | agent-core version `d9134976-d9a7-466b-8a83-cb9ca932f828` deployed |
| 4 | `NANO_AGENT_LIVE_E2E=1 node --test test/cross-e2e/12-real-llm-mainline-smoke.test.mjs` | `1/1 pass` |
| 5 | `pnpm --filter @haimang/agent-core-worker typecheck && pnpm --filter @haimang/agent-core-worker test` | pass |
| 6 | `pnpm test:package-e2e && pnpm test:cross-e2e` | default non-live suites pass with live tests skipped |
| 7 | `./workers/agent-core/node_modules/.bin/tsc -p clients/web/tsconfig.json --noEmit && node --check clients/wechat-miniprogram/utils/nano-client.js && node --check clients/wechat-miniprogram/pages/index/index.js` | client source static/syntax checks pass |
| 8 | `pnpm --filter @haimang/orchestrator-core-worker deploy:preview` | orchestrator-core version `8e08094d-50d1-4672-bf8d-3b3429a566fa` deployed |
| 9 | `NANO_AGENT_LIVE_E2E=1 node --test test/cross-e2e/12-real-llm-mainline-smoke.test.mjs` | pass; emitted `Z4_LIVE_LLM_ANCHOR` with trace/session/usage ids |

---

## 4. 发现与修复摘要

1. **RPC kickoff internal authority preflight**
   - 问题: AgentCore RPC path 只在 outer RPC meta 层校验 authority，没有把 secret/trace/authority header 继续转发到 DO `session.internal` fetch。
   - 修复: `workers/agent-core/src/index.ts` 与 `src/host/internal.ts` 转发 `x-trace-uuid`、`x-nano-internal-authority`、`x-nano-internal-binding-secret`；`NanoSessionDO.fetch()` 对 `session.internal` 做 DO-side `validateInternalAuthority()`。

2. **Live test auth helper fixed**
   - 问题: `test/shared/orchestrator-auth.mjs` 固定要求注册返回 deploy `TEAM_UUID`，但真实 auth 会创建新的 team。
   - 修复: live helper 接受真实注册返回的 `team_uuid`，仅在 auth flow 不可用时才回退本地 JWT secret。

3. **LLM evidence surface calibrated**
   - 问题: orchestrator durable timeline 当前只保留 `turn.begin/end`，不转存 `llm.delta`。
   - 修复: live smoke 以 `turn.end + D1 usage event(provider_key='workers-ai')` 作为可复核 LLM/quota mainline evidence。

4. **Z4-mid hard deadlines**
   - `env.TEAM_UUID` 不再作为 runtime tenant fallback；DO runtime 以 session authority latch 的 `team_uuid` 为准。
   - preview seed owner 改为独立 synthetic owner UUID，不再 `ownerUserUuid = teamUuid`。
   - Workers AI tool declarations 移出 adapter hardcode，并新增与 bash-core minimal registry 的 drift guard。
    - LLM mainline 默认注入 Cloudflare/V8/fake-bash 心智模型 system prompt。

5. **Z4 review-fix transport/client corrections**
   - `orchestrator-core` public auth no longer deploy-fills missing tenant claims from `TEAM_UUID`; JWT must carry `team_uuid` or `tenant_uuid`.
   - `orchestrator-core` WS attach now accepts `last_seen_seq`, replays only frames newer than the client cursor, and emits server-side heartbeat frames every 15s.
   - Web / Mini Program clients now maintain `lastSeenSeq`, send `session.resume`, send heartbeat, ACK streamed frames, and preserve typed error details in their logs.
   - Mini Program WeChat login now posts to the server-owned `/auth/wechat/login` route.

---

## 5. Residual inventory

| 编号 | 标签 | 状态 | 说明 | 建议归属 |
|------|------|------|------|----------|
| R1 | `[follow-up]` | `deferred` | Web / Mini Program 已是可运行 baseline，但未做产品级 UI、复杂消息组件、离线缓存。 | Z5 后产品化阶段 |
| R2 | `[follow-up]` | `deferred` | Mini Program 的 WeChat code-level 登录路径已修为 `/auth/wechat/login`；真实 appid / 微信开发者工具真机截图不在本仓自动化内。 | client hardening |
| R3 | `[follow-up]` | `accepted` | orchestrator client WS stream 仍是 first-wave one-shot timeline snapshot，不是 token-level live push；当前 live evidence 通过 D1 usage 证明 LLM mainline。若需要用户侧实时 token streaming，应在后续明确转存/relay 策略。 | Z5 / transport hardening |
| R4 | `[wont-fix-z4]` | `accepted` | `NANO_AGENT_ALLOW_PREVIEW_TEAM_SEED=true` 仍保留为 preview escape hatch，但不再使用 `ownerUserUuid = teamUuid`。正式 bootstrap owner 流程留给下一阶段。 | deployment/bootstrap |
| R5 | `[follow-up]` | `deferred` | Browser / WeChat manual smoke evidence 尚未发生；本轮证据是 automated live runtime evidence，不伪装成 manual client evidence。 | client hardening |

---

## 6. Z5 closeout supplemental validation

### 6.1 结构化 closeout 锚点

| 字段 | 值 |
|------|----|
| `evidence_artifact` | `docs/eval/zero-to-real/evidence/z5-213260f5-9ff9-4c41-b52f-f9ee11b1ce2e.json` |
| `suite` | `selected-package-e2e-orchestrator-core + all-cross-e2e` |
| `trace_uuid` | `213260f5-9ff9-4c41-b52f-f9ee11b1ce2e` |
| `session_uuid` | `3494d560-389d-44c1-8a96-ae57f8feea77` |
| `usage_event_uuid` | `37bece21-987e-4f69-ad9b-5543f64c1359` |
| `provider_key` | `workers-ai` |
| `live_suite_ok` | `true` |
| `live_suite_pass_count` | `28` |
| `closure_verdict` | `accepted-as-closeout-validation` |

### 6.2 Z5 closeout 额外验证

1. **Preview live smoke**
   - 执行：
     - `NANO_AGENT_LIVE_E2E=1 node --test test/package-e2e/orchestrator-core/{01,02,03,04,05,07}-*.test.mjs test/cross-e2e/*.test.mjs`
   - 结果：
     - `28 / 28 pass`
     - 覆盖 preview probe / public façade / legacy retirement / ws attach / reconnect / bash-core happy-path + cancel + negative / live LLM mainline

2. **Preview D1 SQL spot-check**
   - 执行：
     - `PRAGMA table_info(nano_usage_events);`
     - anchor row lookup
     - core table counts lookup
   - 结果：
     - `provider_key` 列存在（`cid=10`）
     - anchor row 与 live smoke 中的 `usage_event_uuid` / `trace_uuid` / `session_uuid` 一致
     - `nano_users=69 / nano_teams=69 / nano_conversation_sessions=88 / nano_usage_events=80`

3. **解释**
   - 这轮 closeout 验证不是为了替代 Z4 first-real-run artifact，而是为了在写 final closure 前再次确认：
     - live preview 路径仍为绿色
     - D1 schema 与 mainline usage anchor 仍可直接查询
     - zero-to-real 的最终结论不是建立在过期或单次偶然证据之上

## 7. Verdict

Z4 的目标不是完整产品发布，而是让真实客户端与真实 runtime 进入同一条可观测链路。本轮已经完成 web + mini-program scaffolding baseline、RPC authority preflight、remote D1 migration evidence、真实 Workers AI mainline smoke 与 quota evidence；而 Z5 closeout supplemental validation 又再次确认了 live suite 与 D1 anchor 仍然成立。因此 Z4/zero-to-real 的证据口径现在可以稳定收口为：**real-client scaffolding baseline established / live runtime evidence accepted / remaining work is client manual evidence, stream-plane hardening, and productization**。
