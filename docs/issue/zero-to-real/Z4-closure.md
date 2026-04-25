# Z4 Closure — Real Clients and First Real Run

> 服务业务簇: `zero-to-real / Z4`
> 阶段状态: `closed`
> 收口结论: `real-client baseline established`

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

---

## 3. 验证结果

```text
pnpm --filter @haimang/agent-core-worker typecheck
pnpm --filter @haimang/agent-core-worker test
pnpm --filter @haimang/agent-core-worker deploy:preview
NANO_AGENT_LIVE_E2E=1 node --test test/cross-e2e/12-real-llm-mainline-smoke.test.mjs
pnpm test:package-e2e
pnpm test:cross-e2e
./workers/agent-core/node_modules/.bin/tsc -p clients/web/tsconfig.json --noEmit
node --check clients/wechat-miniprogram/utils/nano-client.js
node --check clients/wechat-miniprogram/pages/index/index.js

Result:
- agent-core typecheck/test passed
- agent-core preview deployed as d9134976-d9a7-466b-8a83-cb9ca932f828
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

---

## 5. Residuals

1. **Client product hardening**: Web 与 Mini Program 当前是实验入口，不是产品级 UI。
2. **Mini Program true appid evidence**: code-level WeChat login 已接线；真实 appid / 微信开发者工具截图证据留给后续客户端 hardening。
3. **Streaming visibility**: orchestrator durable timeline 当前不保留 `llm.delta`；Z4 live evidence 用 D1 usage event 证明 LLM mainline。若产品要求客户端实时 token streaming，需要后续收敛 relay/timeline 策略。
4. **Preview seed escape hatch**: preview 仍保留 `NANO_AGENT_ALLOW_PREVIEW_TEAM_SEED=true`，但 synthetic owner 已与 team UUID 分离。正式 bootstrap seed/cleanup 仍应在后续 deployment hardening 中完成。

---

## 6. 最终 verdict

Z4 可以关闭。真实客户端 baseline 已创建，关键 preflight 与 hard-deadline 风险已修到不阻塞 first real run，preview 环境已证明真实 Workers AI mainline 与 quota usage evidence 成立。剩余事项属于客户端产品化、真实小程序运营配置和 transport 可见度增强，不再阻塞 zero-to-real 进入 Z5 closure/handoff。
