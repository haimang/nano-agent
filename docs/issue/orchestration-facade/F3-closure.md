# F3 Closure — Canonical Cutover and Legacy Retirement

> 状态：`closed`
> 日期：`2026-04-24`
> 对应 action-plan：`docs/action-plan/orchestration-facade/F3-canonical-cutover-and-legacy-retirement.md`

## 1. 结论

`orchestrator-core` 已成为唯一 canonical public session ingress，`agent-core` legacy public `/sessions/*` 已进入 typed retirement（HTTP `410` / WS `426`）。F3 的 cutover / live suites / docs truth 已完成同周期收口，F4 可直接开始。

## 2. 本轮真实完成的实现面

1. `test/package-e2e/orchestrator-core/` 已成为 canonical public suite；`agent-core/02-06` session-facing package tests 已删除。
2. affected cross tests `02,03,04,05,06,08,09` 已全部改为经由 `orchestrator-core`；`01` 与 `10` 升级为 5-worker inventory / concurrency probe。
3. `workers/agent-core/src/index.ts` 现对 legacy session HTTP 路由返回 `legacy-session-route-retired / 410`，对 legacy WS 返回 `legacy-websocket-route-retired / 426`。
4. 当期 F3 执行完成时，`workers/orchestrator-core/src/index.ts` probe marker 已 rollover 到 `orchestration-facade-F3`，`/ws` negative taxonomy 允许在 missing / terminal 场景下走 no-upgrade JSON proof；由于 F4/F5 在同一执行链内紧接着完成，当前 HEAD 的 marker 已进一步翻到 `orchestration-facade-closed`。
5. `test/INDEX.md` 与 `workers/{agent-core,orchestrator-core}/README.md` 已同步到 F3 canonical truth。

## 3. 验证证据

### 3.1 本地验证

以下验证已通过：

1. `pnpm --filter @haimang/agent-core-worker typecheck`
2. `pnpm --filter @haimang/agent-core-worker build`
3. `pnpm --filter @haimang/agent-core-worker test`
4. `pnpm --filter @haimang/orchestrator-core-worker typecheck`
5. `pnpm --filter @haimang/orchestrator-core-worker build`
6. `pnpm --filter @haimang/orchestrator-core-worker test`
7. `pnpm test:package-e2e`
8. `pnpm test:cross`

### 3.2 Preview deploy + live proof

Preview 已重新部署：

1. `agent-core` → `https://nano-agent-agent-core-preview.haimang.workers.dev`
2. `orchestrator-core` → `https://nano-agent-orchestrator-core-preview.haimang.workers.dev`

为执行 orchestrator live suite，本轮临时旋转 preview `JWT_SECRET` 到一组本地已知值，并用同值驱动本地签发；未把 secret 写入仓库。

通过结果：

1. `NANO_AGENT_LIVE_E2E=1 pnpm test:package-e2e` → `33 / 33 pass`
2. `NANO_AGENT_LIVE_E2E=1 pnpm test:cross` → `44 / 44 pass`

## 4. Exit criteria 对照

| F3 exit 条件 | 结果 |
| --- | --- |
| orchestrator canonical package suite 建立并接管 public owner | ✅ |
| affected cross-e2e 切到 orchestrator | ✅ |
| `test/INDEX.md` / README / suite truth 同步 | ✅ |
| agent legacy HTTP `410` / WS `426` live negative proof 成立 | ✅ |
| orchestrator probe marker rollover 到 F3 | ✅ |

## 5. 对后续阶段的直接影响

1. F4 可以直接聚焦 authority / tenant / no-escalation hardening，无需再处理 dual-ingress tech debt。
2. `agent-core` 现在是更干净的 runtime host；后续 review 不应再把它当 canonical public edge。
3. live E2E 树已经把 orchestrator 固化为默认 public owner，未来 drift 会更容易被发现。
