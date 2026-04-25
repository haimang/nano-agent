# Z4 Closure — Real Clients and First Real Run

> 服务业务簇: `zero-to-real / Z4`
> 阶段状态: `closed`
> 收口结论: `real-client scaffolding baseline + live runtime evidence established`

---

## 1. 阶段目标回看

Z4 的目标是把 Z0-Z3 的 auth / session truth / runtime / quota 从测试 harness 推到真实客户端入口：创建 `clients/web` 与 `clients/wechat-miniprogram`，并完成第一轮真实 agent loop evidence。

---

## 2. 已完成事项

1. 新增 `clients/web`，提供 Vite + Vanilla TypeScript 的最小真实客户端。
2. 新增 `clients/wechat-miniprogram`，提供微信原生小程序最小真实客户端。
3. 修复 Z4 preflight：RPC kickoff 到 DO fetch path 现在携带并校验 internal secret、trace 与 authority。
4. 完成 `005-usage-events-provider-key.sql` preview remote apply，并确认 `nano_usage_events.provider_key` 存在。
5. 新增 live-facing LLM/quota smoke：真实 session start 后查询 D1 usage event，确认 `provider_key='workers-ai'` 的 LLM mainline evidence。
6. 收紧 Z4-mid hard deadlines：
   - runtime tenant truth 不再从 deploy `TEAM_UUID` fallback；
   - preview synthetic seed owner 不再等于 team UUID；
   - Workers AI tool list 与 bash-core minimal registry 增加 drift guard；
   - LLM mainline 注入 nano-agent system prompt。
7. 吸收 Z4 review 后的客户端/transport 修复：
   - Web / Mini Program 客户端新增 `last_seen_seq`、`session.resume`、`session.heartbeat`、`session.stream.ack` 兼容 wire path；
   - `orchestrator-core` WS attach 新增 client cursor replay 与 15s server heartbeat；
   - Mini Program WeChat 登录路径修正为 `/auth/wechat/login`；
   - `orchestrator-core` auth 不再从 deploy `TEAM_UUID` 填充缺失 tenant claim；
   - 客户端错误日志保留 typed error code / quota detail。

---

## 3. 验证结果

```text
pnpm --filter @haimang/agent-core-worker typecheck
pnpm --filter @haimang/agent-core-worker test
pnpm --filter @haimang/agent-core-worker deploy:preview
pnpm --filter @haimang/orchestrator-core-worker deploy:preview
NANO_AGENT_LIVE_E2E=1 node --test test/cross-e2e/12-real-llm-mainline-smoke.test.mjs
pnpm test:package-e2e
pnpm test:cross-e2e
./workers/agent-core/node_modules/.bin/tsc -p clients/web/tsconfig.json --noEmit
node --check clients/wechat-miniprogram/utils/nano-client.js
node --check clients/wechat-miniprogram/pages/index/index.js

Result:
- agent-core typecheck/test passed
- agent-core preview deployed as d9134976-d9a7-466b-8a83-cb9ca932f828
- orchestrator-core preview deployed as 8e08094d-50d1-4672-bf8d-3b3429a566fa
- live LLM mainline smoke passed
- package/cross E2E default suites passed with live tests skipped
- client source static/syntax checks passed
```

---

## 4. 关键文件

- `clients/web/**`
- `clients/wechat-miniprogram/**`
- `test/cross-e2e/12-real-llm-mainline-smoke.test.mjs`
- `test/shared/orchestrator-auth.mjs`
- `workers/agent-core/src/index.ts`
- `workers/agent-core/src/host/internal.ts`
- `workers/agent-core/src/host/internal-policy.ts`
- `workers/agent-core/src/host/do/nano-session-do.ts`
- `workers/agent-core/src/host/quota/repository.ts`
- `workers/agent-core/src/host/runtime-mainline.ts`
- `workers/agent-core/src/llm/adapters/workers-ai.ts`
- `workers/agent-core/src/llm/tool-registry.ts`
- `docs/eval/zero-to-real/first-real-run-evidence.md`
- `docs/eval/zero-to-real/evidence/z4-254c1dc7-c595-4e14-97cd-7435b008d33c.json`

---

## 5. Residuals

1. **Client product hardening**: Web 与 Mini Program 当前是实验入口，不是产品级 UI。
2. **Mini Program true appid evidence**: code-level WeChat login 已接线；真实 appid / 微信开发者工具截图证据留给后续客户端 hardening。
3. **Streaming visibility**: orchestrator client WS stream 当前是 first-wave one-shot timeline snapshot，不是 token-level live push；Z4 live evidence 用 D1 usage event 证明 LLM mainline。若产品要求客户端实时 token streaming，需要后续收敛 relay/timeline 策略。
4. **Preview seed escape hatch**: preview 仍保留 `NANO_AGENT_ALLOW_PREVIEW_TEAM_SEED=true`，但 synthetic owner 已与 team UUID 分离。正式 bootstrap seed/cleanup 仍应在后续 deployment hardening 中完成。
5. **Manual client smoke**: 本轮自动化 live runtime evidence 已成立，但没有伪造 browser / WeChat devtools 手工截图或真机记录；真实客户端 manual evidence 留给客户端 hardening。
6. **IntentDispatcher / Broadcaster**: Z4 未实现同名模块。当前状态明确为 `deferred-next-phase`；本轮只补 heartbeat / replay cursor / typed client error 的 first-wave transport baseline。

---

## 6. Residual transport inventory

| seam | owner | 保留原因 | 风险 | 候选退役阶段 |
|------|-------|----------|------|--------------|
| `agent-core /internal/sessions/{start,input,cancel,status,timeline,verify}` HTTP relay | `agent-core` | `orchestrator-core -> agent-core` 仍通过 guarded internal HTTP relay 承载多条 session action；RPC kickoff 当前只覆盖已接线入口的一部分。 | 需要持续依赖 binding secret + authority header；若未来 multi-tenant RPC contract 扩展，双路径会增加审计成本。 | Z5 / control-plane RPC 收尾 |
| `agent-core /internal/sessions/stream` NDJSON snapshot | `agent-core` | 持续 push channel 尚未实现；first-wave 使用 timeline/status 合成一次性 NDJSON 供 orchestrator WS attach 转发。 | client 视角不是 inflight token stream，容易与“实时流”术语混淆。 | stream-plane hardening |
| `orchestrator-core /sessions/:uuid/ws?access_token=...` query token compatibility | `orchestrator-core` | 微信小程序 WS attach 难以稳定设置标准 bearer header；Z4 保留 query token 仅用于 WS。 | URL token 需要严格限定在 WS compatibility path，不能扩散到 HTTP action。 | client SDK hardening |
| `clients/*` hand-written session heartbeat/replay envelope | `clients/web`, `clients/wechat-miniprogram` | `clients/` 当前不在 pnpm workspace；Mini Program 也不能直接 import workspace TS package，因此先实现 wire-compatible helper。 | 与 `@haimang/nacp-session` helper 可能产生形状漂移，需要后续生成/共享 JS shim。 | client package extraction |

---

## 7. 最终 verdict

Z4 可以关闭为 **real-client scaffolding baseline + live runtime evidence established**。真实客户端目录、登录/session/WS/timeline 最小入口、关键 authority preflight、heartbeat/replay first-wave 修复与 Workers AI quota evidence 已成立；但 browser / WeChat manual evidence 与 token-level live streaming 不能在本轮被夸大为已完成。剩余事项属于客户端产品化、真实小程序运营配置和 stream-plane hardening，不再阻塞 zero-to-real 进入 Z5 closure/handoff。
