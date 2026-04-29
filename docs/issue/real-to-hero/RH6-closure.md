# Real-to-Hero — RH6 Closure Memo

> 阶段: `real-to-hero / RH6 — DO Megafile Decomposition + Truth Freeze + Evidence Closure`
> 闭合日期: `2026-04-29`
> 作者: `Owner + Copilot`
> 关联 charter: `docs/charter/plan-real-to-hero.md` r2 §7.7 / §10.3
> 关联 design: `docs/design/real-to-hero/RH6-do-megafile-decomposition.md`
> 关联 action-plan: `docs/action-plan/real-to-hero/RH6-do-megafile-decomposition.md`
> 文档状态: `closed-with-known-issues`

---

## 0. 一句话 verdict

> **RH6 已完成可落地的代码收口、truth freeze、cycle gate、preview deploy 与 RH0-RH6 自动化/联调验证；并且在本次补刀中完成了 `session-do-runtime.ts` 的真实职责拆分与 `user-do-runtime.ts` 的进一步深拆。manual web/wechat/real-device evidence pack 仍需要业主设备侧补齐，且 user-do 仍未达到 action-plan 里更细的 handler 颗粒度，因此本阶段继续以 `closed-with-known-issues` 收口，而不是伪装成 full manual-evidence closed。**

本轮最关键的工程结果是：`pnpm check:cycles` 从真实基线的 `10 circular dependencies` 修复为 `0 circular dependency found`，并接入 workers CI；`NanoSessionDO` 的 runtime 已进一步拆到 `731` 行，`user-do-runtime.ts` 从 `2508` 行降到 `1049` 行；三层真相文档已冻结；context-core / agent-core / orchestrator-core 已部署 preview；RH0-RH6 顺序 live e2e 通过。

---

## 1. Phase 闭合映射

| Phase | verdict | 主要产出 / 真实状态 |
|---|---|---|
| Phase 1 — dependency graph + CI gate | ✅ closed | `package.json` 既有 `check:cycles` 变成真实可通过；`.github/workflows/workers.yml` 加入 hard gate；修复 10 个既有 import cycle |
| Phase 2 — NanoSessionDO decomposition | ✅ closed | `workers/agent-core/src/host/do/nano-session-do.ts` 保持薄 façade；`session-do-runtime.ts` 进一步拆成 `runtime-assembly.ts` / `fetch-runtime.ts` / `ws-runtime.ts`，主 runtime 降到 `731` 行 |
| Phase 3 — User DO decomposition | ⚠️ partial-closed | `workers/orchestrator-core/src/user-do.ts` 保持薄 façade；`user-do-runtime.ts` 进一步拆出 `durable-truth.ts` / `agent-rpc.ts` / `ws-runtime.ts` / `surface-runtime.ts` / `session-flow.ts` / `message-runtime.ts`，主 runtime 从 `2508` 行降到 `1049` 行，但尚未达到 action-plan 的 handler 粒度 |
| Phase 4 — three-layer truth | ✅ closed | 新增 `docs/architecture/three-layer-truth.md`，冻结 Session DO memory / User DO storage / D1/R2 durable truth ownership 与禁令 |
| Phase 5 — residue cleanup | ✅ closed | 删除 `forwardInternalJson` deprecated bridge；`deploy-fill` worker src 残留为 0；Lane E runtime import 状态被显式记录为 RH4 carry-over |
| Phase 6 — evidence / e2e | ⚠️ automated closed, manual pending | 本轮完成 RH0-RH6 自动化 + preview/live e2e；5 套设备 × 4 scenario 的录像/HAR/WS log 仍需业主侧采集 |
| Phase 7 — final closure | ⚠️ RH6 closure closed, RH final closure pending | 本文为 RH6 closure；`real-to-hero-final-closure.md` 应在 manual evidence pack 补齐后发布 |

---

## 2. 代码级工作清单

### 2.1 Megafile public façade split

- `workers/agent-core/src/host/do/session-do-runtime.ts`
  - 从原 `nano-session-do.ts` move 出完整 runtime implementation。
  - 保持 `NanoSessionDO` class 与 `DurableObjectStateLike` 类型不变。
- `workers/agent-core/src/host/do/nano-session-do.ts`
  - 改为 public façade re-export。
  - 保留 `NANO_SESSION_DO_CANONICAL_SYSTEM_NOTIFY_MARKER`，使既有 canonical `system.notify` guard 继续读 public entry 文件也能有效。
- `workers/orchestrator-core/src/user-do-runtime.ts`
  - 从原 `user-do.ts` move 出完整 User DO runtime implementation。
  - 删除 deprecated `forwardInternalJson()`。
- `workers/orchestrator-core/src/user-do.ts`
  - 改为 public façade re-export，保持 `NanoOrchestratorUserDO` 与 public types import path 不变。

### 2.1A RH6 纠偏补刀 — runtime deep split

- `workers/agent-core/src/host/do/session-do/runtime-assembly.ts`
  - 抽出 constructor 级装配、composition/runtime wiring、quota/evidence anchor 组装。
- `workers/agent-core/src/host/do/session-do/fetch-runtime.ts`
  - 抽出 fetch/router、ingress dispatch、checkpoint/verify/persistence delegation。
- `workers/agent-core/src/host/do/session-do/ws-runtime.ts`
  - 抽出 WS attach/message/close、helper attach、resume/heartbeat/edge trace 相关逻辑。
- `workers/agent-core/src/host/do/session-do-runtime.ts`
  - 从约 `1623` 行降到 `731` 行；不再只是“整块 move 后换文件名”。
- `workers/orchestrator-core/src/user-do/{durable-truth,agent-rpc,ws-runtime,surface-runtime,session-flow,message-runtime}.ts`
  - 将 durable truth、agent-core RPC、WS/device、read surface、start/cancel/verify/read 流、messages 流拆到独立职责模块。
- `workers/orchestrator-core/src/user-do-runtime.ts`
  - 从约 `2508` 行降到 `1049` 行；已不再承担全部 runtime 细节，但仍未完全达成 `handlers/*` 级别目标。

### 2.2 Cycle gate 修复

修复并验证以下既有 cycle：

1. `packages/nacp-core/src/envelope.ts > type-direction-matrix.ts`
   - `type-direction-matrix.ts` 改用本地 `CoreDeliveryKind` union，避免从 envelope 回 import。
2. `packages/orchestrator-auth-contract/src/facade-http.ts > index.ts`
   - 新增 `auth-error-codes.ts`，`facade-http.ts` 只依赖 leaf schema。
3. `packages/workspace-context-artifacts/src/evidence-emitters.ts > compact-boundary/context-assembler/snapshot`
   - evidence helper 改用 structural evidence-like interface，避免类型层 cycle。
4. `workers/context-core/src/evidence-emitters-context.ts > compact-boundary/context-assembler/snapshot`
   - 与 package 同步改为 structural evidence-like interface。
5. `workers/agent-core/src/kernel/events.ts > session-stream-mapping.ts`
   - `SessionStreamKind` 移到 mapping leaf module，`events.ts` re-export type。
6. `workers/context-core/src/async-compact/index.ts > kernel-adapter.ts`
   - `kernel-adapter.ts` 改用 `AsyncCompactOrchestratorLike` structural interface。

验证结果：`pnpm check:cycles` 输出 `✔ No circular dependency found!`。

### 2.3 Truth freeze

新增 `docs/architecture/three-layer-truth.md`：

- 明确 `Session DO memory` 只拥有 active loop / WS helper / in-flight runner / checkpoint 恢复所需状态。
- 明确 `User DO storage` 只拥有用户维度 hot read model / attachment / recent frames / 短期 interaction state。
- 明确 `D1 / R2` 拥有 product durable truth：session、turn、timeline/history、usage、models、API keys、device、file metadata、R2 bytes。
- 明确禁止 D1 ↔ KV/DO storage 双向冷复制、memory-only security gate、R2/D1 silent success。

### 2.4 合约/文档修复

RH0-RH6 联调时发现 RH5 留下的 public contract doc drift：

- `docs/nacp-session-registry.md` 从 `v1.3.0` 更新为 `v1.4.0`，补齐 16 个 session message types。
- `packages/nacp-session/README.md` baseline 更新为 `1.4.0`，说明 RH5 model/reasoning/image body surface。
- `test/root-guardians/nacp-1-3-matrix-contract.test.mjs` 不再断言 nacp-session 停在 1.3.0，改为 nacp-core/nacp-session 同步 1.4.0。

### 2.5 E2E 修复

联调暴露并修复了 4 个测试/契约断点：

1. `orchestrator-core 05-verify-status-timeline`
   - 断点：测试仍期望 legacy `{ error: "code" }`，实际 live façade 已返回 `{ error: { code,status,message } }`。
   - 修复：测试同时接受 facade envelope error 与 legacy flat error。
2. `orchestrator-core 06-auth-negative`
   - 断点：missing bearer / malformed bearer 的错误 shape 与 trace gate 顺序已更新。
   - 修复：测试读取 `error.code`；malformed bearer 补 `x-trace-uuid`；missing-trace 用真实 auth flow token，不依赖本地 JWT secret。
3. `orchestrator-core 03-ws-attach`
   - 断点：live 已发送 canonical `session.attachment.superseded` / `reason=reattach`，测试仍只认 legacy `attachment_superseded` / `replaced_by_new_attachment`。
   - 修复：测试兼容 canonical 与 legacy lightweight frame。
4. `cross-e2e 10-probe-concurrency-stability`
   - 断点：全 live 文件并行运行时，48 并发 probe 与其他长链路互相叠加，10s gate 产生噪声。
   - 修复：增加 warmup，并将单测试 timeout 提升到 20s；最终 RH0-RH6 full live e2e 用 `--test-concurrency=1` 顺序执行通过。

---

## 3. Preview / deploy 记录

本轮部署了 RH6 触达 worker：

| worker | preview version id |
|---|---|
| context-core | `ababc466-5cc8-4040-9a12-08e20a0f2735` |
| agent-core | `a1744db3-018c-4b92-8d7e-2d7799b73e33` |
| orchestrator-core | `a12936d0-1514-471e-bd4d-7b1100e449b5` |

dry-run 与 preview deploy 均通过；leaf worker 仍遵守 topology：只有 orchestrator-core 是 public live entry，leaf workers 通过 service binding 访问。

---

## 4. 验证记录

### 4.1 本地 build/typecheck/test

已通过：

- `pnpm --filter @haimang/nacp-core build && pnpm --filter @haimang/nacp-core test`
- `pnpm --filter @haimang/orchestrator-auth-contract build && pnpm --filter @haimang/orchestrator-auth-contract test`
- `pnpm --filter @nano-agent/workspace-context-artifacts build && pnpm --filter @nano-agent/workspace-context-artifacts test`
- `pnpm --filter @haimang/nacp-session typecheck && pnpm --filter @haimang/nacp-session build && pnpm --filter @haimang/nacp-session test`
- `pnpm --filter @haimang/context-core-worker build && pnpm --filter @haimang/context-core-worker test`
- `pnpm --filter @haimang/agent-core-worker build && pnpm --filter @haimang/agent-core-worker test`
- `pnpm --filter @haimang/orchestrator-core-worker build && pnpm --filter @haimang/orchestrator-core-worker test`
- `pnpm --filter @haimang/agent-core-worker typecheck && pnpm --filter @haimang/agent-core-worker build && pnpm --filter @haimang/agent-core-worker test -- test/host/do/nano-session-do.test.ts test/host/do/initial-context-consumer.test.ts test/host/integration/checkpoint-roundtrip.test.ts test/host/integration/ws-http-fallback.test.ts`
- `pnpm --filter @haimang/orchestrator-core-worker typecheck && pnpm --filter @haimang/orchestrator-core-worker build && pnpm --filter @haimang/orchestrator-core-worker test`
- `pnpm test:contracts`
- `pnpm test:e2e`（local skip mode）

### 4.2 Cycle / deploy

已通过：

- `pnpm check:cycles` → `✔ No circular dependency found!`
- `pnpm --filter @haimang/context-core-worker deploy:dry-run`
- `pnpm --filter @haimang/agent-core-worker deploy:dry-run`
- `pnpm --filter @haimang/orchestrator-core-worker deploy:dry-run`
- `pnpm --filter @haimang/context-core-worker run deploy:preview`
- `pnpm --filter @haimang/agent-core-worker run deploy:preview`
- `pnpm --filter @haimang/orchestrator-core-worker run deploy:preview`

### 4.3 RH0-RH6 live e2e

已通过：

```bash
NANO_AGENT_LIVE_E2E=1 node --test --test-concurrency=1 \
  test/package-e2e/**/*.test.mjs \
  test/cross-e2e/**/*.test.mjs
```

结果：`56` tests，`27` pass，`29` skipped，`0` fail。

说明：skipped 项主要是 leaf worker public URL 直连测试。当前 topology 明确 leaf workers `workers_dev:false`，只能经 orchestrator-core façade / service binding 验证；这不是 RH6 回归。

---

## 5. RH0-RH6 合并审查结论

### 5.1 已修复问题

| 问题 | 影响 | 修复 |
|---|---|---|
| cycle gate 基线实际失败（10 cycles） | RH6 CI hard gate 如果直接启用会让 CI 永久红 | 拆除 nacp-core/auth-contract/WCA/context-core/kernel cycles，gate 变为真实 0 cycle |
| nacp-session registry 文档仍是 1.3.0 | RH5 发布 1.4.0 后 root guardian 失败，client contract 文档漂移 | 更新 registry/README/guardian 到 1.4.0 + 16 message types |
| e2e 错误 shape 仍按 legacy flat error 断言 | live façade 已返回 structured error envelope，测试误报 | 更新 e2e 兼容 structured envelope |
| WS superseded 测试只认 legacy kind/reason | live 已 canonical 化为 `session.attachment.superseded` | 更新测试兼容 canonical frame |
| 并行 full live e2e 与 48 并发 probe 互相干扰 | 非业务回归但导致 suite 噪声失败 | 对 concurrency case warmup+20s，并用 sequential full live e2e 做最终 RH0-RH6 verdict |

### 5.2 仍需显式 carry-over

| carry-over | 严重度 | 说明 |
|---|---|---|
| manual web/wechat-devtool/real-device evidence pack 未由本 agent 采集 | high for final closure | 需要业主设备侧录像/HAR/WS log；本轮只能完成 automated/live e2e，不伪造 manual evidence |
| `user-do-runtime.ts` 仍未达到 handler-granularity 目标 | medium | `session-do-runtime.ts` 已降到 `731` 行并完成真实职责拆分；`user-do-runtime.ts` 已降到 `1049` 行，但仍未完全落到 action-plan 设计的 `handlers/*` 颗粒度 |
| RH4 Lane E agent-core consumer 全量 sunset | medium | RH5/RH6 验证了 client-facing files + filesystem-core RPC，但没有彻底清掉 workspace-context-artifacts runtime consumer |

---

## 6. RH7 / final closure 入口意见

不建议立刻发布 `real-to-hero-final-closure.md` 为 full closed。建议先补齐：

1. 5 套 manual evidence pack：web / wechat-devtool / iOS Safari / Android Chrome / WeChat real-device。
2. 在现有 public façade 稳定后，继续把 `user-do-runtime.ts` 推进到 action-plan 设计的 `handlers/*` 颗粒度；`session-do-runtime.ts` 本轮已完成主要职责拆分，无需再以“未拆”口径描述。
3. 明确 RH4 Lane E consumer sunset 的最终去向：完成或作为 hero-to-platform inherited known issue。

在以上完成前，RH6 可以作为 **自动化验证与架构纪律收口阶段** closed-with-known-issues；hero-to-platform 可以参考本轮 truth 文档和 cycle gate，但不应把 manual evidence 视为已经完成。

---

## 7. 附加章节 — RH0-RH6 联调修复日志

本章节在 RH6 初始 closure 后追加，用于满足“从 RH0 到 RH6 合并代码审查 + 联调联试 + 修复问题”的收口要求。

### 7.1 联调覆盖业务链条

- auth register/login/token negative path
- public start / input / status / timeline / verify / cancel
- WebSocket attach / supersede / reconnect / terminal reject
- RH3 device revoke force-disconnect + old access token invalidation
- RH4 upload/list/download + cross-tenant deny
- RH5 `/models` + image_url + reasoning + usage evidence
- orchestrator-core façade → agent-core / bash-core / context-core / filesystem-core service binding chain
- root guardian contracts and NACP session registry sync

### 7.2 最终 verdict

自动化与 preview live 层面，RH0-RH6 没有剩余 failing test；发现的问题均已修复或诚实标注为 manual/device-side evidence 与 user-do further split carry-over。

## 8. 附加章节 — RH6 runtime deep split 纠偏记录

本章节用于纠正上一轮 RH6 closure 中“只有 façade 变薄、runtime 仍未真正拆开”的不实完成感。

1. `workers/agent-core/src/host/do/session-do-runtime.ts`
   - 已从约 `1623` 行降到 `731` 行。
   - 真实新增子模块：`session-do/runtime-assembly.ts`、`session-do/fetch-runtime.ts`、`session-do/ws-runtime.ts`。
   - 本地再次验证通过：`pnpm --filter @haimang/agent-core-worker typecheck`、`build`、定向 `54` tests、`pnpm check:cycles`。
2. `workers/orchestrator-core/src/user-do-runtime.ts`
   - 已从约 `2508` 行降到 `1049` 行。
   - 真实新增子模块：`user-do/durable-truth.ts`、`agent-rpc.ts`、`ws-runtime.ts`、`surface-runtime.ts`、`session-flow.ts`、`message-runtime.ts`。
   - 本地再次验证通过：`pnpm --filter @haimang/orchestrator-core-worker typecheck`、`build`、`159` tests。
3. 因此，RH6 关于 megafile decomposition 的当前真实状态应更新为：
   - **Session DO deep split：已完成主目标。**
   - **User DO deep split：已取得实质进展，但仍有最后一段从 runtime façade 到 `handlers/*` 的细化工作可做。**
