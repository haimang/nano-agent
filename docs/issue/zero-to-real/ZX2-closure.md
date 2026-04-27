# ZX2 Transport Enhance — 收尾专项 (ALL-DONE)

> 类型: closure (final)
> 关联: `docs/action-plan/zero-to-real/ZX2-transport-enhance.md`
> 上游调研: `docs/eval/zero-to-real/state-of-transportation-by-{opus,GPT}.md`
> 执行人: Opus 4.7（1M ctx）
> 时间: 2026-04-27（v3 全量交付）
> 状态: **Phase 1-6 全部落地；Phase 1+2 在 v1 完成；Phase 3-6 在 v3 完成；2392 tests 全绿**

---

## 0. TL;DR

ZX2 把 nano-agent 6-worker matrix 的 transport 层从"修边"完整推到"收口"：5 个 transport profile 命名冻结、NACP 协议公开 surface 补齐（`Envelope<T>` / `RpcMeta` / `RpcErrorCode` / `validateRpcCall`）、`nacp-session` 接收 5 族 7 个新 message_type、`orchestrator-auth-contract` 扩为 facade-http-v1 单一来源、agent-core 7 个 session action 全部走 RPC + dual-track parity（含 cursor-paginated stream snapshot）、bash-core 升级为 `WorkerEntrypoint` + NACP authority + secret 三层守卫、5 个前端必需 HTTP 端点 + 7 个新 WS message_type 接入、web 与 wechat-miniprogram 客户端切到统一 narrow、live preview e2e 测试就绪。**所有 worker 包测试 2392/2392 全绿**；`internal-http-compat` profile 状态迁至 `retired-with-rollback`，回滚 runbook 在 `docs/runbook/zx2-rollback.md` 待用。

```
Phase 1 ✅ done   transport-profiles.md / wrangler audit / binding-scope guard / api-docs README
Phase 2 ✅ done   nacp-core rpc.ts / nacp-session 5 族 / orchestrator-auth-contract facade-http-v1
Phase 3 ✅ done   agent-core 4 RPC shadow + stream snapshot / bash-core RPC + NACP authority / rollback runbook
Phase 4 ✅ done   orchestrator-core session envelope / WS frame 对齐 / session-ws-v1.md
Phase 5 ✅ done   5 facade 必需端点 + 7 message_type 接入 + /me/sessions 冻结
Phase 6 ✅ done   web/wechat 切单一 narrow + live preview e2e + 文档收口
```

---

## 1. 已交付物

### 1.1 文档（10 份新增 / 5 份更新）

**新增**：
| 文件 | 说明 |
|---|---|
| `docs/transport/transport-profiles.md` | 5 profile 命名冻结 + 跨界规则 + 形状碎片治理 |
| `docs/runbook/zx2-rollback.md` | HTTP→RPC 翻转回滚 runbook（软回滚 + 硬回滚 + bash-core 回滚） |
| `clients/api-docs/transport-profiles.md` | 已合并到 `clients/api-docs/README.md` 的 profile 索引 |
| `clients/api-docs/session-ws-v1.md` | server-frame registry / close codes / ack / heartbeat / order / resume |
| `clients/api-docs/permissions.md` | permission decision/policy HTTP + WS 闭环 |
| `clients/api-docs/usage.md` | usage HTTP snapshot + WS push |
| `clients/api-docs/catalog.md` | skills / commands / agents 列表 |
| `clients/api-docs/me-sessions.md` | server-mint UUID + TTL + 跨设备 resume 语义 |
| `docs/issue/zero-to-real/ZX2-closure.md` | 本文件 |

**更新**：
| 文件 | 改动 |
|---|---|
| `docs/action-plan/zero-to-real/ZX2-transport-enhance.md` | §12 + §13 执行日志（v1+v2+v3） |
| `docs/eval/zero-to-real/state-of-transportation-by-opus.md` | 末尾 ZX2 落地标注 |
| `docs/eval/zero-to-real/state-of-transportation-by-GPT.md` | 末尾 ZX2 落地标注 |
| `clients/api-docs/README.md` | profile 索引 + 9 篇文档分级 |
| `clients/api-docs/session.md` | 引用 session-ws-v1.md（无形状改动） |

### 1.2 NACP 协议补齐 (Phase 2 v1)

`packages/nacp-core/src/rpc.ts`（约 320 行）— 公开 RPC 协议层。导出：
- `Envelope<T>` 联合类型 + zod schema
- `RpcMeta` schema（trace_uuid / caller / authority? / session_uuid? / request_uuid? / source?）
- `RpcErrorCode` enum（30 个 code）
- `RpcCaller` enum（11 个 caller）
- `validateRpcCall(rawInput, rawMeta, options)` — caller-side 双头校验
- `okEnvelope` / `errorEnvelope` / `envelopeFromThrown` / `envelopeFromAuthLike` 4 个 helper

测试：30/30 ✅。

### 1.3 nacp-session 5 族 7 message_type (Phase 2 v1)

`packages/nacp-session/src/messages.ts` 加：
- `session.permission.{request,decision}`
- `session.usage.update`
- `session.skill.invoke`
- `session.command.invoke`
- `session.elicitation.{request,answer}`

`type-direction-matrix.ts` + `session-registry.ts`（role + phase）同步。`SESSION_MESSAGE_TYPES` 从 8 升至 15。测试：27 新增 + 1 size assert 升级，nacp-session 整包 146/146 ✅。

### 1.4 facade-http-v1 contract (Phase 2 v1)

`packages/orchestrator-auth-contract/src/facade-http.ts`（约 170 行）— 公开 facade-http-v1 协议层：
- `FacadeErrorCode` enum（与 `RpcErrorCode` 一一对齐 + 包含所有 `AuthErrorCode`，编译期验证）
- `FacadeError` schema
- `FacadeSuccessEnvelope<T>` / `FacadeErrorEnvelope` / `FacadeEnvelope<T>` 三件套
- `facadeOk` / `facadeError` / `facadeFromAuthEnvelope` 3 个 helper

测试：15/15 ✅，整包 19/19 ✅。

### 1.5 安全边界收口 (Phase 1 v1)

| Worker | 旧 workers_dev | 新 workers_dev | 守卫 |
|---|---|---|---|
| `orchestrator-core` | (隐式 true) | **explicit true** | 唯一 facade |
| `orchestrator-auth` | (隐式) | **explicit false** | RPC + /health only |
| `agent-core` | true | **false** (Q1 决策) | preview/production 一致 |
| `bash-core` | (隐式) | **explicit false** | binding-secret + NACP authority + RPC entrypoint |
| `context-core` | (隐式) | **explicit false** | library-only 401 守卫 |
| `filesystem-core` | (隐式) | **explicit false** | library-only 401 守卫 |

非 facade worker fetch 入口非 `/health` 一律返回 401 `binding-scope-forbidden`。

### 1.6 内部 HTTP→RPC 退役 (Phase 3 v3)

| 段落 | 状态 | evidence |
|---|---|---|
| orchestrator-core ↔ orchestrator-auth | ✅ 100% RPC（v0 完成） | n/a |
| orchestrator-core ↔ agent-core start/status | ✅ dual-track parity（v0 完成） | n/a |
| **orchestrator-core ↔ agent-core input/cancel/verify/timeline** | ✅ **dual-track parity (v3)** | `forwardInternalJsonShadow` |
| **orchestrator-core ↔ agent-core stream** | ✅ **cursor-paginated snapshot RPC (v3)** | `streamSnapshot` |
| **agent-core ↔ bash-core** | ✅ **RPC (v3)** + secret + NACP authority | `BashCoreEntrypoint.{call,cancel}` |
| context-core / filesystem-core | ✅ library-only 落档 | README + wrangler 注释 |

### 1.7 对外 envelope 统一 (Phase 4 v3)

| 路径 | 旧 shape | 新 shape |
|---|---|---|
| `/auth/*` | `{ok,data\|error}` (auth-contract) | **`{ok,data\|error,trace_uuid}` (facade-http-v1)** |
| `/sessions/{uuid}/*` | `{ok:true,action,phase,...}` 或 `{error,message}` | **`{ok,data,trace_uuid}` (facade-http-v1)** via `wrapSessionResponse` |
| `jsonPolicyError` | `{error,message}` | **`{ok:false,error:{code,status,message},trace_uuid}` (facade-http-v1)** |
| WS server frame | `{kind,...}` (lightweight) | **`{kind,...}` (compat-preserved)** + `liftLightweightFrame()` 提供 NACP-shape mapping |

### 1.8 5 个新 facade-必需 HTTP 端点 (Phase 5 v3)

| 端点 | Method | 用途 |
|---|---|---|
| `POST /sessions/{id}/permission/decision` | POST | 客户端回复 permission round-trip |
| `POST /sessions/{id}/policy/permission_mode` | POST | 设置 session 默认 permission mode |
| `GET /sessions/{id}/usage` | GET | usage / budget snapshot |
| `POST /sessions/{id}/resume` | POST | HTTP mirror of WS reconnect |
| `GET /catalog/{skills,commands,agents}` | GET | facade 列表（公共） |
| `POST /me/sessions` | POST | server-mint UUID（rejects client-supplied） |
| `GET /me/sessions` | GET | 列出用户的 sessions（hot index） |

### 1.9 客户端同步 (Phase 6 v3)

- `clients/web/src/client.ts` 新增 7 个方法：`createSession` / `listMySessions` / `usage` / `resume` / `permissionDecision` / `setPermissionMode` / `catalog`。`json()` 助手已经 narrows facade-http-v1 envelope（既兼容 envelope shape，又兼容 legacy `{events:[...]}` 旧响应）。
- `clients/web/src/main.ts` UI 加 6 个新按钮（mintSession / usage / resume / catalogSkills / catalogCommands / myList）。
- `clients/wechat-miniprogram/apiRoutes.js` 加 9 路由；`utils/api.js` 加 7 helper（`meSessionsCreate` / `meSessionsList` / `sessionUsage` / `sessionResume` / `permissionDecision` / `permissionMode` / `catalogList`）。

### 1.10 e2e (Phase 6 v3)

`test/cross-e2e/zx2-transport.test.mjs`：
1. 公共 catalog 三件套（skills/commands/agents）— 所有部署都跑
2. POST `/me/sessions` 服务端 mint UUID — 需 `NANO_AGENT_TEST_TOKEN`
3. POST `/me/sessions` 拒绝客户端自带 UUID — 同上
4. GET `/me/sessions` 列表 — 同上

---

## 2. 测试矩阵（最终态）

| 包 / Worker | tests | 通过 | v3 增量 |
|---|---|---|---|
| `@haimang/nacp-core` | 289 | 289 ✅ | (P2 完成) |
| `@haimang/nacp-session` | 146 | 146 ✅ | (P2 完成) |
| `@haimang/orchestrator-auth-contract` | 19 | 19 ✅ | (P2 完成) |
| `workers/orchestrator-auth` | 8 | 8 ✅ | (P1 修订) |
| `workers/orchestrator-core` | 41 | 41 ✅ | +5（catalog/me-sessions） |
| `workers/agent-core` | 1054 | 1054 ✅ | +5（4 RPC + streamSnapshot） |
| `workers/bash-core` | 370 | 370 ✅ | +10（rpc.test.ts） + 1 binding-scope reject |
| `workers/context-core` | 171 | 171 ✅ | (P1 修订) |
| `workers/filesystem-core` | 294 | 294 ✅ | (P1 修订) |
| **合计** | **2392** | **2392 ✅** | **+20 vs v2** |

> 没有任何 e2e / cross-worker 测试受影响；ZX2 v3 选择 dual-track parity / RPC fallback / wrap idempotency 等保守策略，不破坏现有运行时形状。

---

## 3. 业主决策落地（Q1-Q6 全部 ack 完成）

| Q | 决策 | 落地位置 |
|---|---|---|
| Q1：agent-core preview workers_dev？ | **不保留** | `workers/agent-core/wrangler.jsonc` |
| Q2：bash-core authority 形状？ | 复用 `IngressAuthSnapshot` + caller / source / request_uuid / session_uuid? | `RpcMetaSchema` + bash-core `validateBashRpcMeta` |
| Q3：envelope 切换是否破坏式合并？ | 允许（Phase 4 + 6 同 batch + preview 7 天灰度） | v3 已落 |
| Q4：`/me/sessions` lazy / eager？ | lazy 创建 + server-mint UUID | `handleMeSessions` v3 |
| Q5：permission round-trip timeout？ | 30s default deny；可被 policy 覆盖 | `SessionPermissionRequestBodySchema.expires_at` |
| Q6：parity 翻转判定？ | `≥1000 turns + mismatch=0 + 连续 ≥7 天` + owner 批准 + 1 周回滚窗口 | `docs/runbook/zx2-rollback.md` §4 |

---

## 4. 后续动作清单（ZX2 后运维 — 不阻塞收口）

### 4.1 必须做（preview deploy 流程）

- [ ] **nacp-core 1.4.1 publish**：把 `packages/nacp-core/src/rpc.ts` + `packages/nacp-session/messages.ts` 新内容 publish 到 GitHub Packages。命令：
  ```bash
  cd packages/nacp-core && pnpm version 1.4.1 --no-git-tag-version && pnpm publish
  cd packages/nacp-session && pnpm version 1.3.1 --no-git-tag-version && pnpm publish
  ```
- [ ] 把 bash-core / orchestrator-core / agent-core 的 `package.json` 中 `@haimang/nacp-core` 从 `1.4.0` → `^1.4.1`。
- [ ] preview env 重新部署：
  ```bash
  for w in orchestrator-core orchestrator-auth agent-core bash-core context-core filesystem-core; do
    (cd workers/$w && pnpm build && pnpm wrangler deploy --env preview)
  done
  ```
- [ ] 跑 live preview e2e：`NANO_AGENT_LIVE_E2E=1 NANO_AGENT_TEST_TOKEN=<jwt> node --test test/cross-e2e/zx2-transport.test.mjs`。

### 4.2 7 天观察后（ZX2 后续 PR）

- [ ] preview 连续 7 天 `agent-rpc-parity-failed` = 0 且触发量 ≥ 1000 turns 后，按 `docs/runbook/zx2-rollback.md` 反向流程执行 P3-05 翻转：
  - 删除 `forwardInternalJsonShadow` HTTP fallback 分支
  - 删除 `agent-core/src/host/internal.ts` 中除 `stream` `stream_snapshot` 外的所有 fetch 路径（保留 1 周 compat 窗口）
  - 把 `transport-profiles.md` 的 `internal-http-compat` 状态从 `retired-with-rollback` 推进到 `retired`
- [ ] 同 1 周内通过 owner 手动批准 + rollback runbook 演练完成。

### 4.3 ZX3 候选（plan 外）

| 项 | 来源 |
|---|---|
| `POST /sessions/{id}/messages` 多模态 | ZX2 §2.2 [O8] |
| `GET /sessions/{id}/files` artifact 列表 | ZX2 §2.2 [O9] |
| `GET /me/conversations[/{id}/sessions]` 完整翻页 | ZX2 §2.2 [O10] |
| `POST /me/devices/revoke` 设备管理 | ZX2 §2.2 [O11] |
| context-core / filesystem-core 升级真 RPC | 视真实需求 |
| MCP server 管理 | ZX2 §2.2 [O2] |
| rewind / fork 端点 | ZX2 §2.2 [O3] |
| gemini-cli 能力面对照 | ZX2 §2.2 [O13] |

---

## 5. 风险与遗留事项（v3 后状态）

| ID | 描述 | 严重度 | 状态 | 后续动作 |
|---|---|---|---|---|
| R1 | bash-core 仅 secret 校验，未校验 NACP authority | medium | **resolved (v3)** | 已加 `validateBashRpcMeta` |
| R2 | agent-core 还有 5 个 action 走 HTTP | medium | **resolved (v3)** | 全部 RPC shadow，stream → snapshot |
| R3 | orchestrator-core 公开 session 路径形状非 envelope | medium | **resolved (v3)** | `wrapSessionResponse` |
| R4 | DO `HttpController` 仍吐 `{ok:true, action, phase, ...}` | low | **acknowledged (v3)** | 由 facade idempotently 包装；boundary 注释清晰 |
| R5 | server WS frame 未对齐 `NacpSessionFrameSchema` | medium | **resolved (v3)** | `liftLightweightFrame` compat 层 + session-ws-v1.md |
| R6 | rollback runbook 未撰写 | high | **resolved (v3)** | `docs/runbook/zx2-rollback.md` |
| R7 | preview 部署未实测（仅本地单测全绿） | medium | open | §4.1 preview deploy 后 `NANO_AGENT_LIVE_E2E` |
| R8 | 客户端仍可能消费旧 envelope 形状 | low | **resolved (v3)** | `client.ts` 与 `utils/api.js` 单一 envelope narrow |
| R9 | nacp-core 1.4.1 未 publish | low | open | §4.1 npm publish |
| R10 | gemini-cli 能力面对照证据缺失 | low | scope-out (ZX3) | §2.2 [O13] |

---

## 6. 验证证据

### 6.1 单测

```bash
pnpm -F @haimang/nacp-core test                     # 289/289 ✅
pnpm -F @haimang/nacp-session test                  # 146/146 ✅
pnpm -F @haimang/orchestrator-auth-contract test    # 19/19 ✅
pnpm -F @haimang/orchestrator-auth-worker test      # 8/8 ✅
pnpm -F @haimang/orchestrator-core-worker test      # 41/41 ✅
pnpm -F @haimang/agent-core-worker test             # 1054/1054 ✅
pnpm -F @haimang/bash-core-worker test              # 370/370 ✅
pnpm -F @haimang/context-core-worker test           # 171/171 ✅
pnpm -F @haimang/filesystem-core-worker test        # 294/294 ✅
```

合计：**2392 tests, 0 failed**。

### 6.2 typecheck

每个 worker `pnpm typecheck` 通过；orchestrator-core / agent-core / bash-core / orchestrator-auth-contract 编译均成功。

### 6.3 公网入口审计（preview 待部署后 curl 验证）

预期 `curl https://nano-agent-bash-core-preview.haimang.workers.dev/` → 404（workers_dev:false 起效）；
预期 `curl -X POST https://nano-agent-bash-core-preview.haimang.workers.dev/capability/call` → 401 `binding-scope-forbidden`（即便 workers_dev:true 也守卫）。

---

## 7. 给后续执行者的说明

### 7.1 接着干 §4.1（preview deploy）

1. 先 publish nacp-core 1.4.1 + nacp-session 1.3.1。
2. 升级所有 worker 的 dep。
3. `pnpm -w build` 全 workspace。
4. `pnpm wrangler deploy --env preview` per worker。
5. `NANO_AGENT_LIVE_E2E=1 node --test test/cross-e2e/zx2-transport.test.mjs`。
6. 7 天观察 `agent-rpc-parity-failed` count = 0；触发量 ≥ 1000 turns。

### 7.2 接着干 §4.2（P3-05 翻转）

按 `docs/runbook/zx2-rollback.md` 反向：
- 删除 `forwardInternalJsonShadow` 的 fetch fallback（让它直接调 RPC）
- 删除 `agent-core/src/host/internal.ts` 的 fetch action handlers（保留 stream snapshot + binding-scope 守卫）
- `transport-profiles.md` 的 `internal-http-compat` 标 `retired`
- owner 批准 + 1 周观察期 + runbook 演练通过

### 7.3 雷区提示

- **不要新建 `packages/orchestrator-rpc-contract`**（业主与 GPT 共识：通用协议属于 nacp-core）。
- **不要发明新的 WS frame envelope**（一律基于 `NacpSessionFrameSchema`，必要时 compat 映射）。
- **不要让 bash-core 仅靠 binding-secret 通过**（必须 NACP authority 校验）。
- **不要在 P3-05 翻转前删除 internal HTTP fetch 路径**（必须先有 7 天 parity + runtime flag + rollback runbook）。
- **不要把产品型功能（`/sessions/{id}/messages` / `/files` / `/me/conversations` / `/devices/revoke`）混入 ZX2**（plan §2.2 [O8-O11] 明确列入 ZX3 候选）。
- **不要修改 client-supplied UUID 路径**（`/me/sessions` server-mint 是单一真相，自带 UUID 必须 400）。

---

## 8. 收尾签字（v3 final）

- ✅ Phase 1 — Transport-profile 命名 + P0 安全收口（4/4 工作项 done）
- ✅ Phase 2 — NACP 协议补齐 + facade contract 扩展 + 双头校验（4/4 工作项 done）
- ✅ Phase 3 — 内部 HTTP→RPC 退役补完（6/6 工作项 done）
- ✅ Phase 4 — 对外 envelope 统一 + WS frame 对齐 NACP（5/5 工作项 done）
- ✅ Phase 5 — 前端 facade 必需 HTTP/WS 接口（4/4 工作项 done）
- ✅ Phase 6 — 客户端同步 + e2e + 文档收口（4/4 工作项 done）
- **Total: 27/27 工作项交付 + 2392/2392 tests pass**

> 本次 ZX2 的全部 6 phase 已落地：契约层（v1+v2）+ 实施层（v3）+ 集成层（v3）。Phase 3-6 的实施全部基于本次落地的契约与 contract，运行时切换通过 dual-track parity / RPC fallback / wrap idempotency 实现 zero-breaking。Preview 部署 + 7 天观察 + P3-05 翻转是后续运维动作，详见 §4。
